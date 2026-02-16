import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql/sqlite3";
import { INIT_SQL } from "../db/init.sql";

const dataDir = join(process.cwd(), "data");
if (!existsSync(dataDir)) {
	mkdirSync(dataDir, { recursive: true });
}
const dbPath = join(dataDir, "oasys.sqlite");
const db = drizzle({ connection: { url: pathToFileURL(dbPath).href } });

let initDone = false;

async function ensureSchema() {
	if (initDone) return;
	initDone = true;
	const statements = INIT_SQL.split(";").map((s) => s.trim()).filter(Boolean);
	for (const stmt of statements) {
		if (stmt) await db.run(sql.raw(stmt));
	}
}

export function getDb() {
	return db;
}

/** Call before using the DB so the schema exists (idempotent). */
export async function ensureDb() {
	await ensureSchema();
}
