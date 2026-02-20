/**
 * Check for updates from GitHub releases and run the install script if a newer version exists.
 * When run as the compiled oasys binary (Unix), spawns a detached shell that kills this process,
 * runs the installer (which updates in place via install.sh), then restarts the new binary.
 */

import { join, dirname } from "path";
import { runCommand } from "./command";

/** GitHub repo for oasys releases (owner/repo). */
export const GITHUB_REPO = "purplem0n/oasys";

const GITHUB_API = "https://api.github.com";
export const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/oasys-tui/install.sh`;

export type UpdateCheckResult =
  | { ok: true; current: string; latest: string; updateAvailable: boolean }
  | { ok: false; error: string };

/** Parse "v1.2.3" or "1.2.3" into [major, minor, patch] or null. */
function parseVersion(s: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(s.trim());
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/** Compare two version tuples. Returns -1 if a < b, 0 if equal, 1 if a > b. */
function compareVersions(
  a: [number, number, number],
  b: [number, number, number]
): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

/**
 * Check GitHub releases for the latest version and compare with current.
 * Handles "dev" and missing/invalid versions (treats as outdated when latest is numeric).
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) {
      return { ok: false, error: `GitHub API returned ${res.status}` };
    }
    const data = (await res.json()) as { tag_name?: string };
    const latestTag = data.tag_name;
    if (!latestTag || typeof latestTag !== "string") {
      return { ok: false, error: "No release tag in response" };
    }
    const latest = latestTag.replace(/^v/, "");
    const currentParsed = parseVersion(currentVersion);
    const latestParsed = parseVersion(latestTag);
    if (!latestParsed) {
      return { ok: false, error: `Invalid latest tag: ${latestTag}` };
    }
    // "dev" or non-semver current → consider update available if we have a numeric release
    const updateAvailable = !currentParsed
      ? true
      : compareVersions(currentParsed, latestParsed) < 0;
    return {
      ok: true,
      current: currentVersion,
      latest: latestTag.startsWith("v") ? latestTag : `v${latest}`,
      updateAvailable,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type RunInstallResult = { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string };

/**
 * Spawn a detached shell that: (1) sends SIGTERM to this process, (2) waits for it to exit,
 * (3) runs the install script with OASYS_INSTALL_DIR set to the current binary's directory so
 * install.sh overwrites in place, (4) exec's the new binary to restart.
 * Use when running as the compiled oasys binary on Unix. On Windows, falls back to runInstallScript.
 */
export function runUpdateViaDetachedShell(): RunInstallResult {
  if (typeof process === "undefined") {
    return { ok: false, error: "No process" };
  }
  const pid = process.pid;
  const rawPath = process.execPath ?? "oasys";
  const execPath = rawPath.startsWith("/") ? rawPath : join(process.cwd(), rawPath);
  const installDir = dirname(execPath);

  if (process.platform === "win32") {
    return { ok: false, error: "Detached in-place update is not supported on Windows; use /update and restart manually." };
  }

  const script = `kill -TERM "${pid}" 2>/dev/null || true
while kill -0 "${pid}" 2>/dev/null; do sleep 0.5; done
export OASYS_INSTALL_DIR="${installDir.replace(/"/g, '\\"')}"
curl -fsSL "${INSTALL_SCRIPT_URL}" | bash
exec "${installDir.replace(/"/g, '\\"')}/oasys"
`;
  try {
    const Bun = (globalThis as unknown as {
      Bun?: {
        spawn: (cmd: string[], opts: {
          cwd: string;
          stdout: "ignore" | "pipe";
          stderr: "ignore" | "pipe";
          env?: Record<string, string | undefined>;
          detached?: boolean;
        }) => { unref?: () => void };
      };
    }).Bun;
    if (Bun?.spawn) {
      const sub = Bun.spawn(["sh", "-c", script], {
        cwd: process.cwd(),
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env },
        detached: true,
      });
      sub.unref?.();
      return { ok: true };
    }
    return { ok: false, error: "Bun.spawn not available" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run the official install script in the current process (downloads and installs).
 * install.sh uses OASYS_INSTALL_DIR if set, else dirname of \`command -v oasys\` (update in place), else ~/.local/bin.
 * User must restart oasys to use the new version unless runUpdateViaDetachedShell was used.
 */
export async function runInstallScript(): Promise<RunInstallResult> {
  const cwd = typeof process !== "undefined" ? process.cwd() : ".";
  const cmd = `curl -fsSL "${INSTALL_SCRIPT_URL}" | bash`;
  try {
    const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
    if (exitCode !== 0) {
      return { ok: false, error: stderr.trim() || stdout.trim() || `Exit code ${exitCode}` };
    }
    return { ok: true, stdout, stderr };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
