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
  const match = message.match(/\bsol[- ]?00[1-6]\b/i);

  if (!match) {
    return null;
  }

  return `sol-${match[0].slice(-3)}`;
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

export async function runAgent(
  context: AgentContext,
): Promise<AgentResult> {
  const caseId = extractCase(context.message);

  if (caseId) {
    const toolCalls: AgentToolCall[] = [];

    try {
      const readArgs = { caso: CaseId.parse(caseId) };
      const readResult = await oc_leer_paquete(readArgs.caso);

      toolCalls.push({
        tool: "oc_leer_paquete",
        status: "success",
        arguments: readArgs,
        result: readResult,
      });

      await auditTool(
        context.sessionId,
        "oc_leer_paquete",
        readArgs,
        readResult,
        "success",
      );

      const validationResult = await oc_validar(readArgs.caso);

      toolCalls.push({
        tool: "oc_validar",
        status: "success",
        arguments: readArgs,
        result: validationResult,
      });

      await auditTool(
        context.sessionId,
        "oc_validar",
        readArgs,
        validationResult,
        "success",
      );

      const answer = buildValidationReply(caseId, validationResult);

      return {
        ...answer,
        toolCalls,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido.";

      return {
        reply: `No pude procesar ${caseId}: ${message}`,
        toolCalls,
        needsConfirmation: false,
        pendingCase: null,
      };
    }
  }

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "Eres un agente conversacional de órdenes de compra SAP simulado. " +
        "Responde en español. Pide el identificador de la solicitud " +
        "si el usuario no lo proporciona. Nunca inventes resultados.",
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
      return {
        reply:
          response.content ||
          "Indica el identificador de la solicitud, por ejemplo sol-002.",
        toolCalls: [],
        needsConfirmation: false,
        pendingCase: null,
      };
    }

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

      const args = parsed.data;

      try {
        const result =
          call.name === "oc_leer_paquete"
            ? await oc_leer_paquete(args.caso)
            : await oc_validar(args.caso);

        const toolCall: AgentToolCall = {
          tool: call.name,
          status: "success",
          arguments: args,
          result,
        };

        await auditTool(
          context.sessionId,
          call.name,
          args,
          result,
          "success",
        );

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