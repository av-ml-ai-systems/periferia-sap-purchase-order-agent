
import "dotenv/config";
import express from "express";
import path from "node:path";
import { z } from "zod";
import { oc_crear, oc_validar } from "./tools/oc.js";
import { askOllama } from "./llm/ollama.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const ChatRequest = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.string().min(1).max(4000),
});

const CaseId = z.enum([
  "sol-001",
  "sol-002",
  "sol-003",
  "sol-004",
  "sol-005",
  "sol-006",
]);

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type ToolCall = {
  tool: string;
  status: "success" | "error";
  result: unknown;
};

type Session = {
  history: ChatMessage[];
  pendingCase: string | null;
};

const sessions = new Map<string, Session>();

function getSession(sessionId: string): Session {
  let session = sessions.get(sessionId);

  if (!session) {
    session = { history: [], pendingCase: null };
    sessions.set(sessionId, session);
  }

  return session;
}

function addMessage(
  session: Session,
  role: ChatMessage["role"],
  content: string,
): void {
  session.history.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });

  if (session.history.length > 100) {
    session.history.splice(0, session.history.length - 100);
  }
}

function isConfirmation(message: string): boolean {
  return /^(si|sí|confirmo|confirmar|acepto|autorizo|yes|confirm|proceed)[.! ]*$/i.test(
    message.trim(),
  );
}

function isRejection(message: string): boolean {
  return /^(no|cancelar|cancela|rechazo|no confirmo|cancel)[.! ]*$/i.test(
    message.trim(),
  );
}

async function interpretCase(
  message: string,
): Promise<{ caseId: string | null; toolCall: ToolCall }> {
  const directMatch = message.match(/\bsol-00[1-6]\b/i);

  if (directMatch) {
    const parsed = CaseId.safeParse(directMatch[0].toLowerCase());

    return {
      caseId: parsed.success ? parsed.data : null,
      toolCall: {
        tool: "resolver_identificador",
        status: parsed.success ? "success" : "error",
        result: {
          source: "identificador explícito",
          caseId: parsed.success ? parsed.data : null,
        },
      },
    };
  }

  try {
    const response = await askOllama([
      {
        role: "system",
        content:
          "Eres un clasificador de solicitudes para un agente de órdenes de compra. " +
          "Identifica cuál caso de prueba solicita el usuario. Los únicos casos " +
          "válidos son sol-001, sol-002, sol-003, sol-004, sol-005 y sol-006. " +
          "Si el usuario dice primer caso, caso uno o solicitud inicial, elige sol-001. " +
          "Si menciona segundo caso, elige sol-002; tercero, sol-003; cuarto, sol-004; " +
          "quinto, sol-005; sexto, sol-006. Si no se puede determinar, usa null. " +
          'Responde únicamente JSON válido con esta forma: {"caseId":"sol-001"} ' +
          'o {"caseId":null}. No ejecutes acciones ni inventes otros identificadores.',
      },
      { role: "user", content: message },
    ]);

    const jsonText = response.match(/\{[\s\S]*\}/)?.[0];
    const parsedJson: unknown = jsonText ? JSON.parse(jsonText) : null;

    const OutputSchema = z.object({
      caseId: CaseId.nullable(),
    });

    const parsed = OutputSchema.safeParse(parsedJson);
    const caseId = parsed.success ? parsed.data.caseId : null;

    return {
      caseId,
      toolCall: {
        tool: "ollama_interpretar_solicitud",
        status: "success",
        result: {
          model: MODEL,
          caseId,
          rawResponse: response,
        },
      },
    };
  } catch (error) {
    return {
      caseId: null,
      toolCall: {
        tool: "ollama_interpretar_solicitud",
        status: "error",
        result: {
          error:
            error instanceof Error
              ? error.message
              : "No fue posible interpretar la solicitud.",
        },
      },
    };
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "ollama",
    model: MODEL,
    agentMode: "llm-assisted",
  });
});

app.get("/api/sessions/:id", (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada." });
    return;
  }

  res.json({
    history: session.history,
    needsConfirmation: session.pendingCase !== null,
    pendingCase: session.pendingCase,
  });
});

app.post("/api/chat", async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Solicitud inválida.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { sessionId, message } = parsed.data;
  const session = getSession(sessionId);
  const toolCalls: ToolCall[] = [];

  addMessage(session, "user", message);

  try {
    let reply: string;
    let needsConfirmation = false;

    if (session.pendingCase && isConfirmation(message)) {
      const caseId = session.pendingCase;
      const result = await oc_crear(caseId, true, sessionId);

      toolCalls.push({
        tool: "oc_crear",
        status: "success",
        result,
      });

      session.pendingCase = null;

      reply =
        result.resultado === "creada"
          ? `Orden creada correctamente para ${caseId}. Número de OC: ${result.numero_oc}.`
          : `No se pudo crear la orden para ${caseId}: ${JSON.stringify(result)}`;
    } else if (session.pendingCase && isRejection(message)) {
      const caseId = session.pendingCase;
      session.pendingCase = null;
      reply = `Operación cancelada. No se creó la orden para ${caseId}.`;
    } else if (session.pendingCase) {
      needsConfirmation = true;
      reply =
        `La solicitud ${session.pendingCase} sigue pendiente de confirmación. ` +
        "Responde «confirmo» para continuar o «cancelar» para detener la operación.";
    } else {
      const interpretation = await interpretCase(message);
      toolCalls.push(interpretation.toolCall);

      const caseId = interpretation.caseId;

      if (!caseId) {
        reply =
          "Puedo revisar los seis casos de prueba de órdenes de compra. " +
          "Indica el número de caso, por ejemplo «Revisa sol-001» o «Revisa el primer caso». " +
          "Si Ollama no está disponible, escribe el identificador explícito.";
      } else {
        const validation = await oc_validar(caseId);

        toolCalls.push(
          {
            tool: "oc_leer_paquete",
            status: "success",
            result: {
              caso: caseId,
              faltantes: validation.paquete.faltantes,
            },
          },
          {
            tool: "oc_validar",
            status: "success",
            result: validation.validacion,
          },
        );

        if (!validation.validacion.apta) {
          reply =
            `La solicitud ${caseId} está bloqueada. ` +
            validation.validacion.bloqueos.join(" ");
        } else if (validation.validacion.confirmaciones.length > 0) {
          session.pendingCase = caseId;
          needsConfirmation = true;

          reply =
            `La solicitud ${caseId} requiere tu confirmación antes de crear la orden:\n- ` +
            validation.validacion.confirmaciones.join("\n- ") +
            "\n\nResponde «confirmo» para continuar o «cancelar» para detener la operación.";
        } else {
          const result = await oc_crear(caseId);

          toolCalls.push({
            tool: "oc_crear",
            status: result.resultado === "bloqueada" ? "error" : "success",
            result,
          });

          reply =
            result.resultado === "creada"
              ? `Orden creada correctamente. Número de OC: ${result.numero_oc}.`
              : `No se creó la orden: ${JSON.stringify(result)}`;
        }
      }
    }

    addMessage(session, "assistant", reply);

    res.json({
      sessionId,
      reply,
      toolCalls,
      needsConfirmation,
    });
  } catch (error) {
    const messageError =
      error instanceof Error ? error.message : "Error interno.";

    res.status(500).json({
      sessionId,
      error: messageError,
      toolCalls,
    });
  }
});

app.listen(PORT, () => {
  console.log(`API disponible en http://localhost:${PORT}`);
});
