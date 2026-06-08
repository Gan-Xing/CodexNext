import type { CodexThread, CodexThreadItem, CodexThreadTurn } from "./index.js";

const GENERATED_TITLE_LIMIT = 60;

export function deriveCodexConversationTitle(
  thread: CodexThread | null | undefined,
  contextThreads?: CodexThread[] | null
): string | null {
  if (!thread) {
    return null;
  }

  const explicitTitle = normalizeCodexConversationTitle(
    readExplicitThreadTitle(thread)
  );
  if (explicitTitle) {
    return explicitTitle;
  }

  const firstTurnTitle = deriveFirstTurnTitle(thread.turns?.[0]);
  if (firstTurnTitle) {
    return truncateCodexGeneratedTitle(firstTurnTitle);
  }

  const collabPromptTitle = deriveCollabPromptTitle(thread.id, contextThreads);
  if (collabPromptTitle) {
    return truncateCodexGeneratedTitle(collabPromptTitle);
  }

  return null;
}

export function deriveCodexGeneratedTitle(
  input: string | null | undefined
): string | null {
  const normalized = normalizeCodexConversationTitle(input);
  if (!normalized) {
    return null;
  }
  return truncateCodexGeneratedTitle(normalized);
}

export function normalizeCodexConversationTitle(
  input: string | null | undefined
): string {
  if (typeof input !== "string") {
    return "";
  }
  return collapseWhitespace(stripMarkdownForTitle(input));
}

export function truncateCodexGeneratedTitle(input: string): string {
  const normalized = collapseWhitespace(input);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= GENERATED_TITLE_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, GENERATED_TITLE_LIMIT - 1).trimEnd()}…`;
}

function readExplicitThreadTitle(thread: CodexThread): string | null {
  if (typeof thread.title === "string" && thread.title.trim().length > 0) {
    return thread.title;
  }
  if (typeof thread.name === "string" && thread.name.trim().length > 0) {
    return thread.name;
  }
  return null;
}

function deriveFirstTurnTitle(turn: CodexThreadTurn | undefined): string | null {
  if (!turn) {
    return null;
  }

  const inputText = extractTurnInputText(turn);
  if (inputText) {
    return inputText;
  }

  const commentBody = extractTurnCommentBody(turn);
  if (commentBody) {
    return commentBody;
  }

  const firstUserItem = turn.items.find((item) => item?.type === "userMessage");
  return extractUserMessageText(firstUserItem?.content);
}

function deriveCollabPromptTitle(
  targetThreadId: string,
  threads: CodexThread[] | null | undefined
): string | null {
  if (!threads?.length) {
    return null;
  }

  for (let index = threads.length - 1; index >= 0; index -= 1) {
    const thread = threads[index];
    if (!thread) {
      continue;
    }
    for (const turn of thread.turns ?? []) {
      for (const item of turn.items ?? []) {
        if (!isCollabAgentToolCallForThread(item, targetThreadId)) {
          continue;
        }
        const prompt = normalizeCodexConversationTitle(
          typeof item.prompt === "string" ? item.prompt : null
        );
        if (prompt) {
          return prompt;
        }
      }
    }
  }

  return null;
}

function extractTurnInputText(turn: CodexThreadTurn): string | null {
  const params = asRecord(turn.params);
  if (!params) {
    return null;
  }
  const text = extractTextInputArray(params.input);
  return text || null;
}

function extractTurnCommentBody(turn: CodexThreadTurn): string | null {
  const params = asRecord(turn.params);
  if (!params) {
    return null;
  }

  const fromCommentAttachments = extractFirstBody(
    Array.isArray(params.commentAttachments) ? params.commentAttachments : []
  );
  if (fromCommentAttachments) {
    return fromCommentAttachments;
  }

  const fromComments = extractFirstBody(
    Array.isArray(params.comments) ? params.comments : []
  );
  if (fromComments) {
    return fromComments;
  }

  return null;
}

function extractFirstBody(items: unknown[]): string | null {
  for (const item of items) {
    const record = asRecord(item);
    if (!record || typeof record.body !== "string") {
      continue;
    }
    const normalized = normalizeCodexConversationTitle(record.body);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function extractTextInputArray(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  const chunks: string[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    if (typeof record.text === "string" && record.text.trim().length > 0) {
      chunks.push(record.text);
    }
  }
  return normalizeCodexConversationTitle(chunks.join("\n\n"));
}

function extractUserMessageText(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const chunks: string[] = [];
  for (const item of content) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    if (typeof record.text === "string" && record.text.trim().length > 0) {
      chunks.push(record.text);
    }
  }

  const normalized = normalizeCodexConversationTitle(chunks.join("\n\n"));
  return normalized || null;
}

function isCollabAgentToolCallForThread(
  item: CodexThreadItem | undefined,
  targetThreadId: string
): item is CodexThreadItem & { prompt: string; receiverThreadIds: string[] } {
  return (
    item?.type === "collabAgentToolCall" &&
    Array.isArray(item.receiverThreadIds) &&
    item.receiverThreadIds.includes(targetThreadId) &&
    typeof item.prompt === "string"
  );
}

function stripMarkdownForTitle(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/!\[([^\]]*)\]\((?:[^)(]+|\([^)(]*\))*\)/g, " $1 ")
    .replace(/\[([^\]]+)\]\((?:[^)(]+|\([^)(]*\))*\)/g, " $1 ")
    .replace(/^ {0,3}(?:#{1,6}\s+|>+\s*|\d+[.)]\s+|[-*+]\s+|\[[ xX]\]\s+)/gm, "")
    .replace(/\[[ xX]\]\s+/g, "")
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/^~~~[^\n]*\n?/gm, "")
    .replace(/```/g, " ")
    .replace(/~~~/g, " ")
    .replace(/`([^`]+)`/g, " $1 ")
    .replace(/[*_~]+/g, "");
}

function collapseWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
