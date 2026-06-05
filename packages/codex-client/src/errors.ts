import type { RequestId } from "@codexnext/protocol";

export class JsonRpcResponseError extends Error {
  public readonly code: number;
  public readonly data: unknown;
  public readonly id: RequestId;
  public readonly method: string | undefined;

  public constructor(options: {
    id: RequestId;
    code: number;
    message: string;
    data?: unknown;
    method?: string;
  }) {
    super(options.message);
    this.name = "JsonRpcResponseError";
    this.id = options.id;
    this.code = options.code;
    this.data = options.data;
    this.method = options.method;
  }
}

export class JsonRpcTimeoutError extends Error {
  public readonly id: RequestId;
  public readonly method: string;
  public readonly timeoutMs: number;

  public constructor(options: {
    id: RequestId;
    method: string;
    timeoutMs: number;
  }) {
    super(
      `JSON-RPC request "${options.method}" timed out after ${options.timeoutMs} ms`
    );
    this.name = "JsonRpcTimeoutError";
    this.id = options.id;
    this.method = options.method;
    this.timeoutMs = options.timeoutMs;
  }
}

export class JsonRpcTransportClosedError extends Error {
  public constructor(message = "JSON-RPC transport closed") {
    super(message);
    this.name = "JsonRpcTransportClosedError";
  }
}

export class JsonRpcProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "JsonRpcProtocolError";
  }
}

