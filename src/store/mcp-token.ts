/**
 * The MCP access token: one secret in data/mcp-token (mode 0600). Its
 * presence IS the on/off switch for outside agents — no file, no access.
 * Settings → Outside agents creates, shows, rotates, and removes it.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";

const TOKEN_FILE = path.join(PATHS.data, "mcp-token");

export function readMcpToken(): string | null {
	try {
		const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
		return token.length >= 32 ? token : null;
	} catch {
		return null;
	}
}

/** Write a fresh token (turning access on, or rotating it). */
export function writeNewMcpToken(): string {
	const token = randomBytes(32).toString("hex");
	fs.mkdirSync(PATHS.data, { recursive: true });
	const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, token, { mode: 0o600 });
	fs.renameSync(tmp, TOKEN_FILE);
	return token;
}

/** Remove the token (turning access off). */
export function deleteMcpToken(): void {
	fs.rmSync(TOKEN_FILE, { force: true });
}
