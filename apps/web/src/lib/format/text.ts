import type { ChatItem } from "../types";

export function buildChatTailSignature(item: ChatItem | undefined): string {
  if (!item) {
    return "";
  }
  return `${item.id}:${item.status ?? ""}:${item.text.length}:${item.text.slice(-24)}`;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatConnectionError(error: unknown, agentUrl: string): string {
  const message = formatError(error);
  const pageOrigin =
    typeof window === "undefined" ? "current Web page" : window.location.origin;
  let agentHost = "";
  try {
    agentHost = new URL(agentUrl).host;
  } catch {
    agentHost = agentUrl;
  }
  if (
    message.includes("Unexpected Origin") ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError")
  ) {
    return `连接 ${agentHost} 失败：远端 Agent 可能没有允许当前页面 ${pageOrigin}。请把这个 origin 加到 codexnext serve --web-origin，或打开远端 Agent 对应的 Web 页面。`;
  }
  return message;
}

export function readString(
  record: Record<string, unknown>,
  key: string
): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
