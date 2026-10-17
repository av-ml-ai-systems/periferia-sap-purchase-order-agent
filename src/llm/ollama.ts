// src/llm/ollama.ts

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaResponse = {
  message?: {
    role: string;
    content: string;
  };
  error?: string;
};

const OLLAMA_URL =
  process.env.OLLAMA_URL ?? "http://localhost:11434";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL ?? "llama3.2:1b";

export async function askOllama(
  messages: OllamaMessage[],
): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
    }),
    signal: AbortSignal.timeout(60000),
  });

  const data = (await response.json()) as OllamaResponse;

  if (!response.ok) {
    throw new Error(
      data.error ?? `Ollama respondió con HTTP ${response.status}.`,
    );
  }

  const content = data.message?.content;

  if (!content) {
    throw new Error("Ollama devolvió una respuesta vacía.");
  }

  return content;
}