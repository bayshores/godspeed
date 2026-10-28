/**
 * The MCP access token: one secret in data/mcp-token (mode 0600).
 * Outside-agent access is always on (owner, 2026-10-27): the server makes
 * the token on the first page load (app/layout.tsx → server/onboarding.ts)
 * and again whenever the file is missing. Settings → Outside agents shows and rotates it.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";

const TOKEN_FILE = path.join(PATHS.data, "mcp-token");

export function readMcpToken(): string | null {
	try {
		const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
		return token.length >= 32 ? token : null;
	} catch {
		return null;
	}
}

/** Write a fresh token (first start, or rotating it). */
export function writeNewMcpToken(): string {
	const token = randomBytes(32).toString("hex");
	fs.mkdirSync(PATHS.data, { recursive: true });
	const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, token, { mode: 0o600 });
	fs.renameSync(tmp, TOKEN_FILE);
	return token;
}

/** The token, made first if the file is missing. */
export function ensureMcpToken(): string {
	return readMcpToken() ?? writeNewMcpToken();
}
