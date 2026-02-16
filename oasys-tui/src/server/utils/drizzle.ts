import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { INIT_SQL } from "../db/init.sql";

const dataDir = join(process.cwd(), "data");
if (!existsSync(dataDir)) {
	mkdirSync(dataDir, { recursive: true });
}
const dbPath = join(dataDir, "oasys.sqlite");
const sqlite = new Database(dbPath);
const db = drizzle({ client: sqlite });

let initDone = false;

async function ensureSchema() {
	if (initDone) return;
	initDone = true;
	const statements = INIT_SQL.split(";").map((s) => s.trim()).filter(Boolean);
	for (const stmt of statements) {
		if (stmt) sqlite.run(stmt);
	}
}

export function getDb() {
	return db;
}

/** Call before using the DB so the schema exists (idempotent). */
export async function ensureDb() {
	await ensureSchema();
}
