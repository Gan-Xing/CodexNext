import type { LocalEvent } from "@codexnext/protocol";

export interface DeviceEventStoreOptions {
  limit?: number;
}

export class DeviceEventStore {
  private events: LocalEvent[] = [];
  private lastSeenSeq = 0;
  private readonly limit: number;
  private readonly sourceEventKeysByControlSeq = new Map<number, string>();
  private readonly sourceEventSeqs = new Map<string, number>();

  public constructor(options: DeviceEventStoreOptions = {}) {
    this.limit = options.limit ?? 2_000;
  }

  public appendMachineEvent(input: {
    agentRunId: string;
    event: LocalEvent;
  }): { duplicate: boolean; event: LocalEvent } {
    const sourceKey = sourceEventKey(input.event, input.agentRunId);
    const existingSeq = this.sourceEventSeqs.get(sourceKey);
    if (existingSeq !== undefined) {
      return {
        duplicate: true,
        event: this.events.find((event) => event.seq === existingSeq) ?? input.event
      };
    }

    const event = {
      ...input.event,
      seq: this.lastSeenSeq + 1
    };
    this.lastSeenSeq = event.seq;
    this.events.push(event);
    this.sourceEventSeqs.set(sourceKey, event.seq);
    this.sourceEventKeysByControlSeq.set(event.seq, sourceKey);
    if (this.events.length > this.limit) {
      const dropped = this.events.slice(0, this.events.length - this.limit);
      this.events = this.events.slice(this.events.length - this.limit);
      for (const droppedEvent of dropped) {
        const droppedSourceKey = this.sourceEventKeysByControlSeq.get(droppedEvent.seq);
        this.sourceEventKeysByControlSeq.delete(droppedEvent.seq);
        if (
          droppedSourceKey &&
          this.sourceEventSeqs.get(droppedSourceKey) === droppedEvent.seq
        ) {
          this.sourceEventSeqs.delete(droppedSourceKey);
        }
      }
    }
    return { duplicate: false, event };
  }

  public after(seq: number): LocalEvent[] {
    return this.events.filter((event) => event.seq > seq);
  }

}

function sourceEventKey(
  event: LocalEvent,
  agentRunId: string
): string {
  return `${agentRunId}:${event.seq}`;
}
