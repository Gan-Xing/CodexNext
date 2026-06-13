import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { LocalEvent, LocalEventType } from "@codexnext/protocol";
import { devTrace } from "../dev-trace.js";

export interface EventStoreOptions {
  limit?: number | undefined;
}

export interface AppendEventInput {
  type: LocalEventType;
  sessionId?: string | undefined;
  threadId?: string | undefined;
  turnId?: string | undefined;
  payload?: unknown;
}

export class EventStore extends EventEmitter {
  private events: LocalEvent[] = [];
  private seq = 0;
  private readonly limit: number;

  public constructor(options: EventStoreOptions = {}) {
    super();
    this.limit = options.limit ?? 2_000;
  }

  public append(input: AppendEventInput): LocalEvent {
    this.seq += 1;
    const event: LocalEvent = {
      id: randomUUID(),
      seq: this.seq,
      type: input.type,
      ts: Date.now(),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {})
    };

    this.events.push(event);
    if (this.events.length > this.limit) {
      this.events = this.events.slice(this.events.length - this.limit);
    }

    devTrace("event-store.append", {
      seq: event.seq,
      type: event.type,
      sessionId: event.sessionId,
      threadId: event.threadId,
      turnId: event.turnId,
      hasPayload: input.payload !== undefined
    });
    this.emit("event", event);
    return event;
  }

  public after(seq: number): LocalEvent[] {
    return this.events.filter((event) => event.seq > seq);
  }

  public all(): LocalEvent[] {
    return [...this.events];
  }

  public lastSeq(): number {
    return this.seq;
  }
}
