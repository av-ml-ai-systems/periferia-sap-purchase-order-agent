import { z } from "zod";
import { logAudit } from "./audit.js";
import {
  llmProvider,
  type LLMMessage,
  type LLMToolDefinition,
} from "../llm/ollama.js";
import {
  oc_leer_paquete,
  oc_validar,
  oc_crear,
} from "../tools/oc.js";

const parsedLimit = Number.parseInt(
  process.env.AGENT_MAX_ITERATIONS ?? "8",
  10,
);

const MAX_ITERATIONS =
  Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 8;

const CASE_IDS = [
  "sol-001",
  "sol-002",
  "sol-003",
  "sol-004",
  "sol-005",
  "sol-006",
] as const;

const CaseId = z.enum(CASE_IDS);

const tools: LLMToolDefinition[] = [
  {
    name: "oc_leer_paquete",
    description: "Lee los documentos de una solicitud de compra.",
    parameters: {
      type: "object",
      properties: {
        caso: { type: "string", enum: CASE_IDS },
      },
      required: ["caso"],
      additionalProperties: false,
    },
  },
  {
    name: "oc_validar",
    description: "Valida las reglas de negocio de una solicitud de compra.",
    parameters: {
      type: "object",
      properties: {
        caso: { type: "string", enum: CASE_IDS },
      },
      required: ["caso"],
      additionalProperties: false,
    },
  },
];

export type AgentToolCall = {
  tool: string;
  status: "success" | "error";
  arguments: Record<string, unknown>;
  result: unknown;
};

export type AgentResult = {
  reply: string;
  toolCalls: AgentToolCall[];
  needsConfirmation: boolean;
  pendingCase: string | null;
};

type AgentContext = {
  sessionId: string;
  message: string;
  history?: LLMMessage[];
};

type ValidationResult = {
  apta?: boolean;
  bloqueos?: string[];
  confirmaciones?: string[];
  retroactiva?: boolean;
};

function extractCase(message: string): string | null {
  const normalized = message.toLowerCase();

  if (/\b(el|la|este|esta)?\s*(primer|primera)\s+(caso|solicitud)\b/i.test(normalized)) {
    return "sol-001";
  }

  const patterns = [
    /\bsol(?:icitud)?[\s-]+sol[-\s]?00([1-6])\b/i,
    /\bsol[-\s]?00([1-6])\b/i,
    /\bsolicitud\s+00([1-6])\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match) {
      return `sol-00${match[1]}`;
    }
  }

  return null;
}

function requestsCreation(message: string): boolean {
  return /\b(crea|crear|creame|créame|generar|genera|genere|emitir|emite|registrar|registra|crear|creación)\b/i.test(
    message,
  );
}

async function auditTool(
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
  status: "success" | "error",
): Promise<void> {
  try {
    await logAudit({
      sessionId,
      event: "tool_call",
      tool,
      arguments: args,
    });

    await logAudit({
      sessionId,
      event: status === "error" ? "tool_error" : "tool_result",
      tool,
      arguments: args,
      result,
    });
  } catch (error) {
    console.error(
      "Error de auditoría:",
      error instanceof Error ? error.message : error,
    );
  }
}

function buildValidationReply(
  caseId: string,
  result: unknown,
): AgentResult {
  const outer = result as {
    validacion?: ValidationResult;
    apta?: boolean;
    bloqueos?: string[];
    confirmaciones?: string[];
    retroactiva?: boolean;
  };

  const validation = outer.validacion ?? outer;

  if (validation.apta === false) {
    const blockers = validation.bloqueos ?? [];

    return {
      reply: blockers.length
        ? `La solicitud ${caseId} está BLOQUEADA:\n- ${blockers.join("\n- ")}`
        : `La solicitud ${caseId} está bloqueada, pero la herramienta no devolvió el detalle de los bloqueos.`,
      toolCalls: [],
      needsConfirmation: false,
      pendingCase: null,
    };
  }

  if ((validation.confirmaciones?.length ?? 0) > 0) {
    return {
      reply:
        `La solicitud ${caseId} requiere confirmación humana:\n- ` +
        `${validation.confirmaciones!.join("\n- ")}\n\n` +
        "Responde «confirmo» para continuar o «cancelar» para detener la operación.",
      toolCalls: [],
      needsConfirmation: true,
      pendingCase: caseId,
    };
  }

  if (validation.apta === true) {
    return {
      reply:
        `La solicitud ${caseId} superó los controles de validación. ` +
        "Todavía no se ha creado una orden de compra.",
      toolCalls: [],
      needsConfirmation: false,
      pendingCase: null,
    };
  }

  return {
    reply:
      `No fue posible interpretar el resultado de validación de ${caseId}. ` +
      "No puedo confirmar si está aprobada o bloqueada.",
    toolCalls: [],
    needsConfirmation: false,
    pendingCase: null,
  };
}

function looksLikeToolSchema(content: string): boolean {
  return (
    /"name"\s*:\s*"(?:oc_leer_paquete|oc_validar|oc_crear)"/i.test(
      content,
    ) ||
    /"parameters"\s*:\s*\{[\s\S]*"properties"\s*:/i.test(content)
  );
}

async function executeValidation(
  sessionId: string,
  caseId: string,
): Promise<AgentResult> {
  const toolCalls: AgentToolCall[] = [];
  const parsedCase = CaseId.parse(caseId);
  const args = { caso: parsedCase };

  try {
    const readResult = await oc_leer_paquete(parsedCase);

    toolCalls.push({
      tool: "oc_leer_paquete",
      status: "success",
      arguments: args,
      result: readResult,
    });

    await auditTool(
      sessionId,
      "oc_leer_paquete",
      args,
      readResult,
      "success",
    );

    const validationResult = await oc_validar(parsedCase);

    toolCalls.push({
      tool: "oc_validar",
      status: "success",
      arguments: args,
      result: validationResult,
    });

    await auditTool(
      sessionId,
      "oc_validar",
      args,
      validationResult,
      "success",
    );

    const answer = buildValidationReply(parsedCase, validationResult);

    return {
      ...answer,
      toolCalls,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido.";

    return {
      reply: `No pude procesar ${parsedCase}: ${message}`,
      toolCalls,
      needsConfirmation: false,
      pendingCase: null,
    };
  }
}

async function executeCreation(
  sessionId: string,
  caseId: string,
): Promise<AgentResult> {
  const parsedCase = CaseId.parse(caseId);
  const args = {
    caso: parsedCase,
    confirmado: false,
  };

  try {
    const result = await oc_crear(parsedCase, false, sessionId);
    const status = result.resultado === "bloqueada" ? "error" : "success";

    await auditTool(
      sessionId,
      "oc_crear",
      args,
      result,
      status,
    );

    const toolCall: AgentToolCall = {
      tool: "oc_crear",
      status,
      arguments: args,
      result,
    };

    if (result.resultado === "creada") {
      return {
        reply:
          `Orden creada correctamente para ${parsedCase}. ` +
          `Número de OC: ${result.numero_oc}.`,
        toolCalls: [toolCall],
        needsConfirmation: false,
        pendingCase: null,
      };
    }

    if (result.resultado === "pendiente_confirmacion") {
      const confirmations = result.confirmaciones ?? [];

      return {
        reply:
          `La solicitud ${parsedCase} requiere confirmación humana:\n- ` +
          `${confirmations.join("\n- ")}\n\n` +
          "Responde «confirmo» para continuar o «cancelar» para detener la operación.",
        toolCalls: [toolCall],
        needsConfirmation: true,
        pendingCase: parsedCase,
      };
    }

    return {
      reply:
        `No se pudo crear la orden para ${parsedCase}:\n- ` +
        `${(result.bloqueos ?? []).join("\n- ")}`,
      toolCalls: [toolCall],
      needsConfirmation: false,
      pendingCase: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido.";

    return {
      reply: `No pude crear la orden para ${parsedCase}: ${message}`,
      toolCalls: [
        {
          tool: "oc_crear",
          status: "error",
          arguments: args,
          result: { error: message },
        },
      ],
      needsConfirmation: false,
      pendingCase: null,
    };
  }
}

export async function runAgent(
  context: AgentContext,
): Promise<AgentResult> {
  const caseId = extractCase(context.message);

  if (caseId) {
    if (requestsCreation(context.message)) {
      return executeCreation(context.sessionId, caseId);
    }

    return executeValidation(context.sessionId, caseId);
  }

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "Eres un agente conversacional de órdenes de compra SAP simulado. " +
        "Responde siempre en español y con lenguaje claro para el usuario. " +
        "Las herramientas son acciones que debes solicitar mediante " +
        "tool calling; nunca muestres sus esquemas JSON, propiedades, " +
        "parámetros ni definiciones como respuesta. " +
        "No inventes validaciones ni resultados. " +
        "Si el usuario quiere revisar una solicitud pero no proporciona " +
        "un identificador, pídele uno entre sol-001 y sol-006.",
    },
    ...(context.history ?? []),
    { role: "user", content: context.message },
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let response;

    try {
      response = await llmProvider.enviar(messages, tools);
    } catch (error) {
      return {
        reply:
          `No pude consultar el modelo de lenguaje: ${
            error instanceof Error ? error.message : "Error desconocido."
          }`,
        toolCalls: [],
        needsConfirmation: false,
        pendingCase: null,
      };
    }

    if (response.toolCalls.length === 0) {
      const content = response.content?.trim() ?? "";

      if (content && !looksLikeToolSchema(content)) {
        return {
          reply: content,
          toolCalls: [],
          needsConfirmation: false,
          pendingCase: null,
        };
      }

      return {
        reply:
          "No pude interpretar correctamente la respuesta del modelo. " +
          "Si quieres revisar una solicitud, indica su identificador, " +
          "por ejemplo sol-002.",
        toolCalls: [],
        needsConfirmation: false,
        pendingCase: null,
      };
    }

    let executedTool = false;

    for (const call of response.toolCalls) {
      if (call.name !== "oc_leer_paquete" && call.name !== "oc_validar") {
        continue;
      }

      const parsed = z
        .object({ caso: CaseId })
        .safeParse(call.arguments);

      if (!parsed.success) {
        continue;
      }

      executedTool = true;
      const args = parsed.data;

      try {
        const result =
          call.name === "oc_leer_paquete"
            ? await oc_leer_paquete(args.caso)
            : await oc_validar(args.caso);

        await auditTool(
          context.sessionId,
          call.name,
          args,
          result,
          "success",
        );

        const toolCall: AgentToolCall = {
          tool: call.name,
          status: "success",
          arguments: args,
          result,
        };

        if (call.name === "oc_validar") {
          const answer = buildValidationReply(args.caso, result);

          return {
            ...answer,
            toolCalls: [toolCall],
          };
        }

        messages.push({
          role: "assistant",
          content: response.content,
        });

        messages.push({
          role: "user",
          content:
            `Resultado de ${call.name}: ${JSON.stringify(result)}. ` +
            "Usa estos datos para responder sin inventar información.",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Error desconocido.";

        await auditTool(
          context.sessionId,
          call.name,
          args,
          { error: message },
          "error",
        );

        return {
          reply: `La herramienta ${call.name} falló: ${message}`,
          toolCalls: [
            {
              tool: call.name,
              status: "error",
              arguments: args,
              result: { error: message },
            },
          ],
          needsConfirmation: false,
          pendingCase: null,
        };
      }
    }

    if (!executedTool) {
      return {
        reply:
          "El modelo no solicitó una herramienta válida. " +
          "Indica el identificador de la solicitud, por ejemplo sol-002.",
        toolCalls: [],
        needsConfirmation: false,
        pendingCase: null,
      };
    }
  }

  return {
    reply:
      "No pude completar la solicitud dentro del límite de iteraciones. " +
      "Indica el identificador del caso para ejecutar su validación.",
    toolCalls: [],
    needsConfirmation: false,
    pendingCase: null,
  };
}