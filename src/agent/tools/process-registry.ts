import { type ChildProcess } from "child_process";
import { v7 as uuidv7 } from "uuid";

export const MAX_OUTPUT_BUFFER = 64 * 1024; // 64KB per process
export const TERMINATED_PROCESS_TTL = 60 * 60 * 1000; // 1 hour TTL for terminated processes

export type ProcessEntry = {
  id: string;
  command: string;
  cwd?: string | undefined;
  child: ChildProcess;
  exitCode: number | null;
  startedAt: number;
  terminatedAt?: number | undefined;
  outputBuffer: string[];
  outputSize: number;
  source: "exec" | "process";
};

export const PROCESS_REGISTRY = new Map<string, ProcessEntry>();

/**
 * Register a process in the shared registry.
 * Sets up output collection and exit handling.
 */
export function registerProcess(
  child: ChildProcess,
  command: string,
  cwd: string | undefined,
  source: "exec" | "process",
  id?: string,
): string {
  const processId = id ?? uuidv7();

  const entry: ProcessEntry = {
    id: processId,
    command,
    cwd,
    child,
    exitCode: null,
    startedAt: Date.now(),
    outputBuffer: [],
    outputSize: 0,
    source,
  };

  PROCESS_REGISTRY.set(processId, entry);

  // Collect output to buffer with size limit
  const collectOutput = (data: Buffer) => {
    let text = data.toString("utf8");
    // Truncate if single chunk exceeds max buffer
    if (text.length > MAX_OUTPUT_BUFFER) {
      text = text.slice(-MAX_OUTPUT_BUFFER);
      entry.outputBuffer = [];
      entry.outputSize = 0;
    } else if (entry.outputSize + text.length > MAX_OUTPUT_BUFFER) {
      // Remove old entries to make room
      while (
        entry.outputBuffer.length > 0 &&
        entry.outputSize + text.length > MAX_OUTPUT_BUFFER
      ) {
        const removed = entry.outputBuffer.shift();
        if (removed) entry.outputSize -= removed.length;
      }
    }
    entry.outputBuffer.push(text);
    entry.outputSize += text.length;
  };

  child.stdout?.on("data", collectOutput);
  child.stderr?.on("data", collectOutput);

  child.on("close", (code) => {
    entry.exitCode = code;
    entry.terminatedAt = Date.now();
  });

  return processId;
}

/**
 * Remove terminated processes older than TTL.
 * Returns the number of processes removed.
 */
export function cleanupTerminatedProcesses(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, entry] of PROCESS_REGISTRY) {
    if (entry.terminatedAt && now - entry.terminatedAt > TERMINATED_PROCESS_TTL) {
      PROCESS_REGISTRY.delete(id);
      removed++;
    }
  }
  return removed;
}
