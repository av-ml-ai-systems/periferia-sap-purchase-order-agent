
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type AuditEntry = {
  sessionId: string;
  event: "tool_call" | "tool_result" | "tool_error";
  tool: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp?: string;
};

const LOG_DIRECTORY = path.join(process.cwd(), "out");
const LOG_FILE = path.join(LOG_DIRECTORY, "log.jsonl");

export async function logAudit(entry: AuditEntry): Promise<void> {
  const record = {
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };

  await mkdir(LOG_DIRECTORY, { recursive: true });
  await appendFile(
    LOG_FILE,
    `${JSON.stringify(record)}\n`,
    "utf8",
  );
}
