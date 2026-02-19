/** Number of lines to show for command output (min 2, max 20). */
export function outputHeightLines(output: string): number {
  const lines = output?.trim() ? output.split("\n").length : 0;
  return Math.min(20, Math.max(2, lines || 1));
}

/** Strip <command>...</command> markup from assistant text so it's not shown in the UI. */
export function stripCommandMarkup(text: string): string {
  if (!text) return text;
  return text.replace(/<command>[\s\S]*?<\/command>/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

export type RunCommandOpts = {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

/**
 * Run a shell command on the user's local machine. Inherits process.env so PATH (e.g. Homebrew) is available.
 * Optional onStdout/onStderr are called with chunks in real time.
 */
export async function runCommand(
  command: string,
  cwd: string,
  opts: RunCommandOpts = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { onStdout, onStderr } = opts;
  const env = { ...process.env };
  try {
    const Bun = (globalThis as unknown as {
      Bun?: {
        spawn: (cmd: string[], opts: { cwd: string; stdout: "pipe"; stderr: "pipe"; env?: Record<string, string | undefined> }) => {
          exited: Promise<{ exitCode: number }>;
          stdout: ReadableStream<Uint8Array>;
          stderr: ReadableStream<Uint8Array>;
        };
      };
    }).Bun;
    if (Bun?.spawn) {
      const shell = process.platform === "win32" ? "cmd.exe" : "sh";
      const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
      const sub = Bun.spawn([shell, ...args], { cwd, stdout: "pipe", stderr: "pipe", env });
      const decoder = new TextDecoder();
      const drain = async (stream: ReadableStream<Uint8Array>, cb: (chunk: string) => void): Promise<string> => {
        const reader = stream.getReader();
        let out = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const s = decoder.decode(value, { stream: true });
            out += s;
            cb(s);
          }
        } finally {
          reader.releaseLock();
        }
        return out;
      };
      const [exited, stdout, stderr] = await Promise.all([
        sub.exited,
        drain(sub.stdout, (chunk) => onStdout?.(chunk)),
        drain(sub.stderr, (chunk) => onStderr?.(chunk)),
      ]);
      return { stdout, stderr, exitCode: exited.exitCode ?? 0 };
    }
    const cp = (globalThis as unknown as { require?: (id: string) => { spawn: (cmd: string, args: string[], opts: { cwd: string; shell: boolean; env?: NodeJS.ProcessEnv }) => { stdout: { on: (e: string, fn: (d: Buffer) => void) => void }; stderr: { on: (e: string, fn: (d: Buffer) => void) => void }; on: (e: string, fn: (code: number) => void) => void } } }).require?.("child_process");
    if (cp?.spawn) {
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
      const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
      const child = cp.spawn(shell, args, { cwd, shell: true, env });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => {
        const s = d.toString();
        stdout += s;
        onStdout?.(s);
      });
      child.stderr?.on("data", (d: Buffer) => {
        const s = d.toString();
        stderr += s;
        onStderr?.(s);
      });
      return new Promise((resolve) => {
        child.on("close", (code: number) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
      });
    }
  } catch {
    // fallthrough
  }
  return { stdout: "", stderr: "Could not run command (no Bun or child_process)", exitCode: 1 };
}
