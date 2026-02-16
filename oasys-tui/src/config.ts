import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type TuiConfig = {
  googleApiKey?: string;
  userId?: string;
};

const CONFIG_DIR =
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const CONFIG_FILE = join(CONFIG_DIR, "oasys-tui.json");

function ensureConfigDir(): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export function loadConfig(): TuiConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      return {
        googleApiKey:
          typeof data.googleApiKey === "string" ? data.googleApiKey : undefined,
        userId: typeof data.userId === "string" ? data.userId : undefined,
      };
    }
  } catch {
    // ignore
  }
  return {};
}

/** Returns a stable userId for this client; generates and persists one if missing. */
export function getOrCreateUserId(): string {
  const config = loadConfig();
  if (config.userId) return config.userId;
  const userId = crypto.randomUUID();
  saveConfig({ ...config, userId });
  return userId;
}

export function saveConfig(config: TuiConfig): void {
  ensureConfigDir();
  try {
    const existing = loadConfig();
    const data: Record<string, unknown> = {};
    if (config.googleApiKey !== undefined) data.googleApiKey = config.googleApiKey;
    else if (existing.googleApiKey !== undefined) data.googleApiKey = existing.googleApiKey;
    if (config.userId !== undefined) data.userId = config.userId;
    else if (existing.userId !== undefined) data.userId = existing.userId;
    writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save config:", e);
  }
}
