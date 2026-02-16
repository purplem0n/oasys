import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = process.env.OASYS_LOG_DIR ?? join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "api.log");

let stream: ReturnType<typeof createWriteStream> | null = null;

function ensureStream(): ReturnType<typeof createWriteStream> {
	if (stream) return stream;
	if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
	stream = createWriteStream(LOG_FILE, { flags: "a" });
	stream.write(`${timestamp()} [INFO] API log file: ${LOG_FILE}\n`);
	return stream;
}

function timestamp(): string {
	return new Date().toISOString();
}

function formatPayload(msg: unknown): string {
	if (msg === undefined) return "undefined";
	if (typeof msg === "string") return msg;
	try {
		return JSON.stringify(msg);
	} catch {
		return String(msg);
	}
}

export const apiLog = {
	info(...args: unknown[]): void {
		const line = `${timestamp()} [INFO] ${args.map(formatPayload).join(" ")}\n`;
		try {
			ensureStream().write(line);
		} catch (e) {
			// Fallback to stderr so we don't lose logs if file fails
			process.stderr.write(line);
		}
	},
	error(...args: unknown[]): void {
		const line = `${timestamp()} [ERROR] ${args.map(formatPayload).join(" ")}\n`;
		try {
			ensureStream().write(line);
		} catch (e) {
			process.stderr.write(line);
		}
	},
	debug(...args: unknown[]): void {
		const line = `${timestamp()} [DEBUG] ${args.map(formatPayload).join(" ")}\n`;
		try {
			ensureStream().write(line);
		} catch (e) {
			process.stderr.write(line);
		}
	},
};
