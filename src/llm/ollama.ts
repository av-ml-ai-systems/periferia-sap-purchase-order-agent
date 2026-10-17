
export type LLMToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: {
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }[];
};

export type LLMToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LLMResponse = {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason: "stop" | "tool_calls";
};

export interface LLMProvider {
  enviar(
    mensajes: LLMMessage[],
    herramientas?: LLMToolDefinition[],
  ): Promise<LLMResponse>;
}

type OllamaApiResponse = {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: {
      function?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    }[];
  };
  error?: string;
};

export class OllamaAdapter implements LLMProvider {
  private readonly url: string;
  private readonly model: string;

  constructor(
    url = process.env.OLLAMA_URL ?? "http://localhost:11434",
    model = process.env.OLLAMA_MODEL ?? "llama3.2:1b",
  ) {
    this.url = url.replace(/\/+$/, "");
    this.model = model;
  }

  async enviar(
    mensajes: LLMMessage[],
    herramientas: LLMToolDefinition[] = [],
  ): Promise<LLMResponse> {
    const response = await fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: mensajes,
        stream: false,
        ...(herramientas.length > 0
          ? {
              tools: herramientas.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = (await response.json()) as OllamaApiResponse;

    if (!response.ok) {
      throw new Error(
        data.error ?? `Ollama respondió con HTTP ${response.status}.`,
      );
    }

    if (!data.message) {
      throw new Error("Ollama devolvió una respuesta vacía.");
    }

    const toolCalls = (data.message.tool_calls ?? []).map((call) => {
      const name = call.function?.name;
      const args = call.function?.arguments;

      if (!name || !args || typeof args !== "object" || Array.isArray(args)) {
        throw new Error("Ollama devolvió una llamada a herramienta inválida.");
      }

      return { name, arguments: args };
    });

    return {
      content: data.message.content ?? "",
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    };
  }
}

export const llmProvider: LLMProvider = new OllamaAdapter();

export async function askOllama(
  messages: LLMMessage[],
): Promise<string> {
  const response = await llmProvider.enviar(messages);

  if (!response.content) {
    throw new Error("Ollama devolvió una respuesta vacía.");
  }

  return response.content;
}
