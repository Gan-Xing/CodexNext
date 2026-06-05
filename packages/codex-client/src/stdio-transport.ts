import { EventEmitter } from "node:events";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { JsonRpcOutboundMessage } from "@codexnext/protocol";

export interface StdioCodexTransportOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  closeGraceMs?: number;
  stderr?: "ignore" | "emit";
}

export class StdioCodexTransport extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: ReadlineInterface | undefined;
  private started = false;
  private closed = false;

  public constructor(private readonly options: StdioCodexTransportOptions = {}) {
    super();
  }

  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    const command = this.options.command ?? "codex";
    const args = this.options.args ?? ["app-server", "--stdio"];
    this.child = spawn(command, args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.lines = createInterface({ input: this.child.stdout });

    this.lines.on("line", (line) => {
      if (line.trim().length === 0) {
        return;
      }
      try {
        this.emit("message", JSON.parse(line));
      } catch (error) {
        this.emit(
          "error",
          new Error(`Failed to parse app-server JSON line: ${line}`, {
            cause: error
          })
        );
      }
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      if (this.options.stderr === "emit") {
        this.emit("stderr", chunk.toString("utf8"));
      }
    });

    this.child.on("error", (error) => {
      this.emit("error", error);
    });

    this.child.on("exit", (code, signal) => {
      this.closed = true;
      this.lines?.close();
      this.emit("close", { code, signal });
    });
  }

  public send(message: JsonRpcOutboundMessage): void {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("codex app-server stdin is not writable");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    const child = this.child;
    if (!child) {
      return;
    }

    const closeGraceMs = this.options.closeGraceMs ?? 1_500;
    this.lines?.close();

    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      child.once("exit", finish);

      if (child.stdin.writable) {
        child.stdin.end();
      }

      setTimeout(() => {
        if (resolved || child.exitCode !== null || child.signalCode !== null) {
          finish();
          return;
        }
        child.kill("SIGTERM");
      }, closeGraceMs);

      setTimeout(() => {
        if (resolved || child.exitCode !== null || child.signalCode !== null) {
          finish();
          return;
        }
        child.kill("SIGKILL");
        finish();
      }, closeGraceMs * 2);
    });
  }
}

