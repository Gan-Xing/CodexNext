import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { JsonRpcOutboundMessage } from "@codexnext/protocol";
import {
  JsonRpcClient,
  type JsonRpcTransport
} from "../src/json-rpc.js";
import {
  JsonRpcResponseError,
  JsonRpcTimeoutError,
  JsonRpcTransportClosedError
} from "../src/errors.js";

class FakeTransport extends EventEmitter implements JsonRpcTransport {
  public readonly sent: JsonRpcOutboundMessage[] = [];
  public closed = false;

  public send(message: JsonRpcOutboundMessage): void {
    this.sent.push(message);
  }

  public close(): Promise<void> {
    this.closed = true;
    this.emit("close");
    return Promise.resolve();
  }

  public emitMessage(message: unknown): void {
    this.emit("message", message);
  }
}

describe("JsonRpcClient", () => {
  it("increments JSON-RPC request ids", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);

    const first = client.request("first");
    const second = client.request("second");

    expect(transport.sent[0]).toMatchObject({ id: 0, method: "first" });
    expect(transport.sent[1]).toMatchObject({ id: 1, method: "second" });

    transport.emitMessage({ id: 0, result: "ok-0" });
    transport.emitMessage({ id: 1, result: "ok-1" });

    await expect(first).resolves.toBe("ok-0");
    await expect(second).resolves.toBe("ok-1");
  });

  it("matches responses to pending requests", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);

    const first = client.request("first");
    const second = client.request("second");

    transport.emitMessage({ id: 1, result: "second-result" });
    transport.emitMessage({ id: 0, result: "first-result" });

    await expect(first).resolves.toBe("first-result");
    await expect(second).resolves.toBe("second-result");
  });

  it("turns error responses into exceptions", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);

    const pending = client.request("explode");
    transport.emitMessage({
      id: 0,
      error: {
        code: -32000,
        message: "boom",
        data: { detail: "unit-test" }
      }
    });

    await expect(pending).rejects.toBeInstanceOf(JsonRpcResponseError);
    await expect(pending).rejects.toMatchObject({
      code: -32000,
      message: "boom",
      method: "explode"
    });
  });

  it("emits notifications to listeners", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);
    const received: unknown[] = [];

    client.onNotification((notification) => {
      received.push(notification);
    });

    transport.emitMessage({
      method: "turn/started",
      params: { turn: { id: "turn_1" } }
    });

    expect(received).toEqual([
      {
        method: "turn/started",
        params: { turn: { id: "turn_1" } }
      }
    ]);
  });

  it("rejects pending requests on timeout", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport, { defaultTimeoutMs: 5 });

    await expect(client.request("slow")).rejects.toBeInstanceOf(
      JsonRpcTimeoutError
    );
  });

  it("rejects all pending requests when the transport errors", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);
    client.on("error", () => {
      // EventEmitter treats unhandled error events as fatal; the app layer owns logging.
    });

    const first = client.request("first", undefined, { timeoutMs: 1_000 });
    const second = client.request("second", undefined, { timeoutMs: 1_000 });

    transport.emit("error", new Error("lost transport"));

    await expect(first).rejects.toBeInstanceOf(JsonRpcTransportClosedError);
    await expect(first).rejects.toMatchObject({ message: "lost transport" });
    await expect(second).rejects.toBeInstanceOf(JsonRpcTransportClosedError);
    await expect(second).rejects.toMatchObject({ message: "lost transport" });
  });

  it("rejects pending and future requests when the transport closes", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);

    const pending = client.request("slow", undefined, { timeoutMs: 1_000 });
    transport.emit("close");

    await expect(pending).rejects.toBeInstanceOf(JsonRpcTransportClosedError);
    await expect(client.request("after-close")).rejects.toBeInstanceOf(
      JsonRpcTransportClosedError
    );
    expect(transport.sent).toEqual([{ id: 0, method: "slow" }]);
  });

  it("lets server-initiated request handlers return a result", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);

    client.registerRequestHandler("item/tool/requestUserInput", (params) => ({
      accepted: true,
      echo: params
    }));

    transport.emitMessage({
      id: 44,
      method: "item/tool/requestUserInput",
      params: { question: "Continue?" }
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(transport.sent).toEqual([
      {
        id: 44,
        result: {
          accepted: true,
          echo: { question: "Continue?" }
        }
      }
    ]);
  });

  it("returns method-not-found for unknown server-initiated requests", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);

    transport.emitMessage({
      id: 45,
      method: "item/tool/unknown",
      params: { question: "Continue?" }
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(transport.sent).toEqual([
      {
        id: 45,
        error: {
          code: -32601,
          message: 'No handler registered for server request "item/tool/unknown"'
        }
      }
    ]);
  });

  it("turns server-initiated request handler failures into JSON-RPC errors", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);

    client.registerRequestHandler("item/tool/requestUserInput", () => {
      throw new Error("handler failed");
    });

    transport.emitMessage({
      id: 46,
      method: "item/tool/requestUserInput",
      params: { question: "Continue?" }
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(transport.sent).toEqual([
      {
        id: 46,
        error: {
          code: -32000,
          message: "handler failed"
        }
      }
    ]);
  });
});
