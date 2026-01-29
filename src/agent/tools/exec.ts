import { spawn } from "child_process";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { registerProcess } from "./process-registry.js";

const ExecSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute." }),
  cwd: Type.Optional(Type.String({ description: "Working directory." })),
  timeoutMs: Type.Optional(
    Type.Number({ description: "Timeout in milliseconds.", minimum: 0 }),
  ),
  yieldMs: Type.Optional(
    Type.Number({
      description:
        "Auto-background threshold in milliseconds. If command doesn't complete within this time, it runs in background. Default 5000ms. Set to 0 to disable auto-backgrounding.",
      minimum: 0,
    }),
  ),
});

type ExecArgs = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  yieldMs?: number;
};

export type ExecResult = {
  output: string;
  exitCode: number | null;
  truncated: boolean;
  backgrounded?: boolean;
  processId?: string;
};

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_YIELD_MS = 5000;

export function createExecTool(defaultCwd?: string): AgentTool<typeof ExecSchema, ExecResult> {
  return {
    name: "exec",
    label: "Exec",
    description:
      "Execute a shell command. If the command doesn't complete within yieldMs (default 5s), it automatically runs in background and returns a process ID. Use 'process output <id>' to check output, 'process status <id>' to check status, 'process stop <id>' to terminate.",
    parameters: ExecSchema,
    execute: async (_toolCallId, args, signal) => {
      const { command, cwd, timeoutMs, yieldMs = DEFAULT_YIELD_MS } = args as ExecArgs;
      const effectiveCwd = cwd || defaultCwd;

      return new Promise((resolve) => {
        const child = spawn(command, {
          shell: true,
          cwd: effectiveCwd,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let timedOut = false;
        let yielded = false;
        let timeout: NodeJS.Timeout | undefined;
        let yieldTimer: NodeJS.Timeout | undefined;

        // Timeout handling (hard kill)
        if (timeoutMs && timeoutMs > 0) {
          timeout = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs);
        }

        // Yield window handling (auto-background)
        if (yieldMs > 0) {
          yieldTimer = setTimeout(() => {
            if (yielded) return;
            yielded = true;

            // Clear timeout since we're backgrounding
            if (timeout) clearTimeout(timeout);

            // Register to shared process registry
            const processId = registerProcess(child, command, effectiveCwd, "exec");

            resolve({
              content: [
                {
                  type: "text",
                  text: `Command running in background. Process ID: ${processId}\nUse 'process output ${processId}' to check output.`,
                },
              ],
              details: {
                output: "",
                exitCode: null,
                truncated: false,
                backgrounded: true,
                processId,
              },
            });
          }, yieldMs);
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;

        const handleData = (data: Buffer) => {
          if (truncated) return;
          size += data.length;
          if (size > MAX_OUTPUT_BYTES) {
            truncated = true;
            const remaining = MAX_OUTPUT_BYTES - (size - data.length);
            if (remaining > 0) chunks.push(data.subarray(0, remaining));
            return;
          }
          chunks.push(data);
        };

        child.stdout?.on("data", handleData);
        child.stderr?.on("data", handleData);

        let spawnError: Error | null = null;
        child.on("error", (err) => {
          if (timeout) clearTimeout(timeout);
          if (yieldTimer) clearTimeout(yieldTimer);
          spawnError = err;
          // Don't reject, let close event handle
        });

        child.on("close", (code) => {
          if (timeout) clearTimeout(timeout);
          if (yieldTimer) clearTimeout(yieldTimer);

          // If already backgrounded, don't resolve again
          if (yielded) return;

          // If there's a spawn error, return error message
          if (spawnError) {
            resolve({
              content: [{ type: "text", text: `Error: ${spawnError.message}` }],
              details: {
                output: `Error: ${spawnError.message}`,
                exitCode: code ?? 1,
                truncated: false,
              },
            });
            return;
          }

          const output = Buffer.concat(chunks).toString("utf8");
          resolve({
            content: [{ type: "text", text: output || (timedOut ? "Process timed out." : "") }],
            details: {
              output,
              exitCode: code,
              truncated,
            },
          });
        });

        // Signal handling: don't kill if already backgrounded
        if (signal) {
          signal.addEventListener("abort", () => {
            if (yielded) return; // Already backgrounded, ignore abort
            if (timeout) clearTimeout(timeout);
            if (yieldTimer) clearTimeout(yieldTimer);
            child.kill("SIGTERM");
          });
        }
      });
    },
  };
}
