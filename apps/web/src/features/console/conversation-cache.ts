import type { ChatItem } from "../../lib/types";
import type { ConversationCacheEntry } from "../chat/chat-state";

const DB_NAME = "codexnext.conversationCache";
const DB_VERSION = 1;
const STORE_NAME = "conversations";
const SCHEMA_VERSION = 1;
const MAX_THREADS_PER_DEVICE = 120;
const MAX_MESSAGES_PER_THREAD = 100;

interface ConversationCacheRecord extends ConversationCacheEntry {
  deviceId: string;
  id: string;
  schemaVersion: number;
}

export async function readConversationCacheStorage(): Promise<
  Record<string, ConversationCacheEntry[]>
> {
  const db = await openConversationCacheDb();
  if (!db) {
    return {};
  }
  try {
    const records = await readAllRecords(db);
    return records.reduce<Record<string, ConversationCacheEntry[]>>((grouped, record) => {
      const entry = sanitizeConversationCacheRecord(record);
      if (!entry) {
        return grouped;
      }
      grouped[record.deviceId] = [...(grouped[record.deviceId] ?? []), entry];
      return grouped;
    }, {});
  } finally {
    db.close();
  }
}

export async function writeConversationCacheStorage(
  entriesByDeviceId: Record<string, ConversationCacheEntry[]>
): Promise<void> {
  const db = await openConversationCacheDb();
  if (!db) {
    return;
  }
  try {
    await writeRecords(db, entriesByDeviceId);
  } finally {
    db.close();
  }
}

function openConversationCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("deviceId", "deviceId", { unique: false });
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

function readAllRecords(db: IDBDatabase): Promise<ConversationCacheRecord[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as ConversationCacheRecord[]);
  });
}

function writeRecords(
  db: IDBDatabase,
  entriesByDeviceId: Record<string, ConversationCacheEntry[]>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const deviceIds = new Set(Object.keys(entriesByDeviceId).filter(Boolean));
    const readRequest = store.getAll();

    readRequest.onerror = () => reject(readRequest.error);
    readRequest.onsuccess = () => {
      for (const record of readRequest.result as ConversationCacheRecord[]) {
        if (deviceIds.has(record.deviceId)) {
          store.delete(record.id);
        }
      }
      for (const [deviceId, entries] of Object.entries(entriesByDeviceId)) {
        const safeDeviceId = safeString(deviceId);
        if (!safeDeviceId) {
          continue;
        }
        for (const entry of entries
          .map(sanitizeConversationCacheEntry)
          .filter((item): item is ConversationCacheEntry => Boolean(item))
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, MAX_THREADS_PER_DEVICE)) {
          store.put({
            ...entry,
            deviceId: safeDeviceId,
            id: cacheRecordId(safeDeviceId, entry.conversationKey),
            schemaVersion: SCHEMA_VERSION
          } satisfies ConversationCacheRecord);
        }
      }
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

function sanitizeConversationCacheRecord(
  value: ConversationCacheRecord
): ConversationCacheEntry | null {
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return null;
  }
  return sanitizeConversationCacheEntry(value);
}

function sanitizeConversationCacheEntry(value: unknown): ConversationCacheEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const conversationKey = safeString(value.conversationKey);
  if (!conversationKey) {
    return null;
  }
  const items = Array.isArray(value.items)
    ? value.items
        .map(sanitizeCachedChatItem)
        .filter((item): item is ChatItem => Boolean(item))
        .slice(-MAX_MESSAGES_PER_THREAD)
    : [];
  if (items.length === 0) {
    return null;
  }
  const latestSeq =
    typeof value.latestSeq === "number" && Number.isFinite(value.latestSeq)
      ? value.latestSeq
      : null;
  const sessionIds = Array.isArray(value.sessionIds)
    ? value.sessionIds
        .map(safeString)
        .filter((sessionId): sessionId is string => Boolean(sessionId))
    : [];
  return {
    conversationKey,
    items,
    latestSeq,
    sessionIds: [...new Set(sessionIds)],
    threadId: safeString(value.threadId),
    updatedAt: finiteTimestamp(value.updatedAt) ?? Date.now()
  };
}

function sanitizeCachedChatItem(value: unknown): ChatItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = safeString(value.id);
  const role = isChatItemRole(value.role) ? value.role : null;
  const text = typeof value.text === "string" ? value.text.slice(0, 120_000) : null;
  if (!id || !role || text === null || text.trim().length === 0) {
    return null;
  }
  const status = isChatItemStatus(value.status) ? value.status : undefined;
  if (status === "pending" || status === "failed") {
    return null;
  }
  return {
    id,
    role,
    text,
    ...(safeString(value.sessionId) ? { sessionId: safeString(value.sessionId)! } : {}),
    ...(safeString(value.turnId) ? { turnId: safeString(value.turnId)! } : {}),
    ...(safeString(value.clientMessageId)
      ? { clientMessageId: safeString(value.clientMessageId)! }
      : {}),
    ...(status ? { status } : {}),
    ...(finiteTimestamp(value.createdAt) ? { createdAt: finiteTimestamp(value.createdAt)! } : {}),
    ...(typeof value.error === "string" ? { error: value.error.slice(0, 4_000) } : {})
  };
}

function cacheRecordId(deviceId: string, conversationKey: string): string {
  return `${deviceId}:${conversationKey}`;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatItemRole(value: unknown): value is ChatItem["role"] {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "command" ||
    value === "system" ||
    value === "diff" ||
    value === "plan"
  );
}

function isChatItemStatus(value: unknown): value is NonNullable<ChatItem["status"]> {
  return (
    value === "sending" ||
    value === "sent" ||
    value === "streaming" ||
    value === "complete"
  );
}
