import { EventEmitter } from "node:events";
import type {
  AppServerNotification,
  JsonRpcOutboundMessage,
  JsonRpcRequest,
  RequestId
} from "@codexnext/protocol";
import { isRecord } from "@codexnext/protocol";
import {
  JsonRpcProtocolError,
  JsonRpcResponseError,
  JsonRpcTimeoutError,
  JsonRpcTransportClosedError
} from "./errors.js";

export interface JsonRpcTransport {
  send(message: JsonRpcOutboundMessage): void | Promise<void>;
  close(): Promise<void>;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: () => void): this;
}

export type ServerRequestHandler = (
  params: unknown,
  request: JsonRpcRequest
) => unknown | Promise<unknown>;

export type NotificationListener = (
  notification: AppServerNotification
) => void;

interface PendingRequest {
  id: RequestId;
  method: string;
  timer: NodeJS.Timeout;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export interface JsonRpcClientOptions {
  defaultTimeoutMs?: number;
}

export class JsonRpcClient extends EventEmitter {
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly requestHandlers = new Map<string, ServerRequestHandler>();
  private fallbackRequestHandler: ServerRequestHandler | undefined;
  private nextRequestId = 0;
  private closed = false;
  private readonly defaultTimeoutMs: number;

  public constructor(
    private readonly transport: JsonRpcTransport,
    options: JsonRpcClientOptions = {}
  ) {
    super();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.transport.on("message", (message) => {
      void this.handleIncomingMessage(message);
    });
    this.transport.on("error", (error) => {
      this.rejectAll(new JsonRpcTransportClosedError(error.message));
      this.emit("error", error);
    });
    this.transport.on("close", () => {
      this.closed = true;
      this.rejectAll(new JsonRpcTransportClosedError());
      this.emit("close");
    });
  }

  public request<T = unknown>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new JsonRpcTransportClosedError());
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const message: JsonRpcRequest =
      params === undefined ? { id, method } : { id, method, params };

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JsonRpcTimeoutError({ id, method, timeoutMs }));
      }, timeoutMs);

      this.pending.set(id, {
        id,
        method,
        timer,
        resolve: (result) => resolve(result as T),
        reject
      });
    });

    Promise.resolve(this.transport.send(message)).catch((error: unknown) => {
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(toError(error));
    });

    return promise;
  }

  public notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) {
      return Promise.reject(new JsonRpcTransportClosedError());
    }

    const message =
      params === undefined ? { method } : { method, params };
    return Promise.resolve(this.transport.send(message));
  }

  public registerRequestHandler(
    method: string,
    handler: ServerRequestHandler
  ): void {
    this.requestHandlers.set(method, handler);
  }

  public registerFallbackRequestHandler(
    handler: ServerRequestHandler
  ): void {
    this.fallbackRequestHandler = handler;
  }

  public onNotification(listener: NotificationListener): () => void;
  public onNotification(
    method: string,
    listener: (params: unknown, notification: AppServerNotification) => void
  ): () => void;
  public onNotification(
    methodOrListener:
      | string
      | NotificationListener,
    listener?: (params: unknown, notification: AppServerNotification) => void
  ): () => void {
    if (typeof methodOrListener === "function") {
      this.on("notification", methodOrListener);
      return () => this.off("notification", methodOrListener);
    }

    if (!listener) {
      throw new JsonRpcProtocolError("Notification listener is required");
    }

    const eventName = `notification:${methodOrListener}`;
    const wrapped = (notification: AppServerNotification) => {
      listener(notification.params, notification);
    };
    this.on(eventName, wrapped);
    return () => this.off(eventName, wrapped);
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectAll(new JsonRpcTransportClosedError());
    await this.transport.close();
  }

  private async handleIncomingMessage(message: unknown): Promise<void> {
    if (!isRecord(message)) {
      this.emit(
        "error",
        new JsonRpcProtocolError("Received non-object JSON-RPC message")
      );
      return;
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    const method = message.method;

    if (hasId && typeof method === "string") {
      await this.handleServerRequest(message as unknown as JsonRpcRequest);
      return;
    }

    if (hasId) {
      this.handleResponse(message);
      return;
    }

    if (typeof method === "string") {
      const notification: AppServerNotification =
        Object.prototype.hasOwnProperty.call(message, "params")
          ? { method, params: message.params }
          : { method };
      this.emit("notification", notification);
      this.emit(`notification:${method}`, notification);
      return;
    }

    this.emit(
      "error",
      new JsonRpcProtocolError("Received invalid JSON-RPC message")
    );
  }

  private handleResponse(message: Record<string, unknown>): void {
    const id = message.id as RequestId;
    const pending = this.pending.get(id);
    if (!pending) {
      this.emit(
        "error",
        new JsonRpcProtocolError(`No pending request for response id ${String(id)}`)
      );
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (isRecord(message.error)) {
      const code =
        typeof message.error.code === "number" ? message.error.code : -32_000;
      const errorMessage =
        typeof message.error.message === "string"
          ? message.error.message
          : "JSON-RPC error response";
      pending.reject(
        new JsonRpcResponseError({
          id,
          method: pending.method,
          code,
          message: errorMessage,
          data: message.error.data
        })
      );
      return;
    }

    pending.resolve(message.result);
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    const handler =
      this.requestHandlers.get(request.method) ?? this.fallbackRequestHandler;

    if (!handler) {
      await this.sendServerRequestError(
        request.id,
        -32601,
        `No handler registered for server request "${request.method}"`
      );
      return;
    }

    try {
      const result = await handler(request.params, request);
      await Promise.resolve(
        this.transport.send({
          id: request.id,
          result: result === undefined ? null : result
        })
      );
    } catch (error) {
      await this.sendServerRequestError(
        request.id,
        -32_000,
        toError(error).message
      );
    }
  }

  private async sendServerRequestError(
    id: RequestId,
    code: number,
    message: string
  ): Promise<void> {
    await Promise.resolve(
      this.transport.send({
        id,
        error: { code, message }
      })
    );
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

