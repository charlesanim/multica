import { v7 as uuidv7 } from "uuid";
import { Agent as CoreAgent } from "../agent/runner.js";
import { Channel } from "./channel.js";
import type { Message } from "./types.js";

/**
 * Agent — uses pi-agent-core for real inference.
 * write() triggers a model run, read() outputs streaming results.
 */
export class Agent {
  readonly id: string;
  private readonly channel = new Channel<Message>();
  private _closed = false;
  private readonly agent: CoreAgent;
  private queue: Promise<void> = Promise.resolve();

  constructor(id?: string) {
    this.id = id ?? uuidv7();
    this.agent = new CoreAgent({
      logger: {
        stdout: this.createChannelStream("[assistant] "),
        stderr: this.createChannelStream("[tool] "),
      },
      sessionId: this.id,
    });
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Write message to agent (non-blocking, serialized queue) */
  write(content: string): void {
    if (this._closed) {
      throw new Error("Agent is closed");
    }

    this.queue = this.queue
      .then(async () => {
        const result = await this.agent.run(content);
        if (result.error) {
          this.channel.send({
            id: uuidv7(),
            content: `[error] ${result.error}`,
          });
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.channel.send({ id: uuidv7(), content: `[error] ${message}` });
      });
  }

  /** Continuously read message stream */
  read(): AsyncIterable<Message> {
    return this.channel;
  }

  /** Close agent, stop all reads */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.channel.close();
  }

  private createChannelStream(prefix: string): NodeJS.WritableStream {
    let buffer = "";
    return {
      write: (chunk: any) => {
        if (this._closed) return false;
        const text =
          typeof chunk === "string"
            ? chunk
            : chunk?.toString?.() ?? String(chunk);
        if (!text) return true;
        buffer += text;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (part.length === 0) continue;
          this.channel.send({ id: uuidv7(), content: `${prefix}${part}` });
        }
        return true;
      },
    } as NodeJS.WritableStream;
  }
}
