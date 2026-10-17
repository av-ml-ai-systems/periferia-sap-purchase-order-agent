
import "dotenv/config";
import express from "express";
import path from "node:path";
import { z } from "zod";
import { oc_crear } from "./tools/oc.js";
import { runAgent } from "./agent/agent.js";
import { logAudit } from "./agent/audit.js";
import type { LLMMessage } from "./llm/ollama.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const ChatRequest = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.string().min(1).max(4000),
});

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type ToolCall = {
  tool: string;
  status: "success" | "error";
  arguments?: Record<string, unknown>;
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

async function auditCreation(
  sessionId: string,
  caseId: string,
  result: unknown,
  status: "success" | "error",
): Promise<void> {
  try {
    await logAudit({
      sessionId,
      event: "tool_call",
      tool: "oc_crear",
      arguments: { caso: caseId, confirmado: true },
    });

    await logAudit({
      sessionId,
      event: status === "error" ? "tool_error" : "tool_result",
      tool: "oc_crear",
      arguments: { caso: caseId, confirmado: true },
      result,
    });
  } catch (error) {
    console.error(
      "No se pudo registrar la auditoría:",
      error instanceof Error ? error.message : error,
    );
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "ollama",
    model: MODEL,
    agentMode: "tool-calling-agent",
    maxIterations: Number(process.env.AGENT_MAX_ITERATIONS ?? 8),
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

      const status =
        result.resultado === "bloqueada" ? "error" : "success";

      toolCalls.push({
        tool: "oc_crear",
        status,
        arguments: { caso: caseId, confirmado: true },
        result,
      });

      await auditCreation(sessionId, caseId, result, status);

      if (result.resultado === "creada") {
        session.pendingCase = null;
        reply =
          `Orden creada correctamente para ${caseId}. ` +
          `Número de OC: ${result.numero_oc}.`;
      } else if (result.resultado === "pendiente_confirmacion") {
        needsConfirmation = true;
        reply =
          `La solicitud ${caseId} todavía requiere confirmación. ` +
          JSON.stringify(result);
      } else {
        session.pendingCase = null;
        reply = `No se pudo crear la orden para ${caseId}: ${JSON.stringify(result)}`;
      }
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
      const history: LLMMessage[] = session.history
        .slice(0, -1)
        .map((entry) => ({
          role: entry.role,
          content: entry.content,
        }));

      const result = await runAgent({
        sessionId,
        message,
        history,
      });

      reply = result.reply;
      needsConfirmation = result.needsConfirmation;
      session.pendingCase = result.pendingCase;

      for (const call of result.toolCalls) {
        toolCalls.push({
          tool: call.tool,
          status: call.status,
          arguments: call.arguments,
          result: call.result,
        });
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

    addMessage(
      session,
      "assistant",
      `No se pudo completar la solicitud: ${messageError}`,
    );

    res.status(500).json({
      sessionId,
      error: messageError,
      toolCalls,
      needsConfirmation: session.pendingCase !== null,
    });
  }
});

app.listen(PORT, () => {
  console.log(`API disponible en http://localhost:${PORT}`);
});
