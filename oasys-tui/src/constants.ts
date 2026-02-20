import { readFileSync } from "fs";
import { join } from "path";

/** Injected at build time by scripts/build.sh (--define OASYS_VERSION="..."). Undefined in dev. */
declare const OASYS_VERSION: string | undefined;

/** Braille-style spinner: bold and highly visible */
export const LOADING_SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
export const LOADING_SPINNER_INTERVAL_MS = 60;

/** App version: from build define when compiled, else from package.json in cwd (dev). */
export function getAppVersion(): string {
  if (typeof OASYS_VERSION === "string" && OASYS_VERSION) return OASYS_VERSION;
  try {
    const pkgPath = join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "?";
  } catch {
    return "?";
  }
}

export const SLASH_COMMANDS: { name: string; description: string; value: string }[] = [
  { name: "/new", description: "Start a new empty chat room", value: "new" },
  { name: "/setup", description: "Set Google AI API key", value: "setup" },
  { name: "/model", description: "Select model", value: "model" },
  { name: "/history", description: "Open chat history", value: "history" },
  { name: "/thinking", description: "Toggle thinking/reasoning mode", value: "thinking" },
  { name: "/websearch", description: "Toggle web search", value: "websearch" },
  { name: "/version", description: "Show current app version", value: "version" },
  { name: "/update", description: "Check for updates and self-update", value: "update" },
];

export const SERVER_PORT = 9990;
export const DEFAULT_MODEL_KEY = "gemini-flash-lite-latest";
