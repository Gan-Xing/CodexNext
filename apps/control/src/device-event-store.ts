import { EventEmitter } from "node:events";
import type { LocalEvent } from "@codexnext/protocol";

export interface DeviceEventStoreOptions {
  limit?: number;
}

export class DeviceEventStore extends EventEmitter {
  private events: LocalEvent[] = [];
  private lastSeenSeq = 0;
  private readonly limit: number;

  public constructor(options: DeviceEventStoreOptions = {}) {
    super();
    this.limit = options.limit ?? 2_000;
  }

  public append(event: LocalEvent): LocalEvent {
    if (this.events.some((existing) => existing.seq === event.seq)) {
      return this.events.find((existing) => existing.seq === event.seq) ?? event;
    }
    this.lastSeenSeq = Math.max(this.lastSeenSeq, event.seq);
    this.events.push(event);
    if (this.events.length > this.limit) {
      this.events = this.events.slice(this.events.length - this.limit);
    }
    this.emit("event", event);
    return event;
  }

  public after(seq: number): LocalEvent[] {
    return this.events.filter((event) => event.seq > seq);
  }

  public lastSeq(): number {
    return this.lastSeenSeq;
  }

  public all(): LocalEvent[] {
    return [...this.events];
  }
}
