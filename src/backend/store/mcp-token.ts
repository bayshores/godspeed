/**
 * The MCP access token: one secret in data/mcp-token (mode 0600).
 * Outside-agent access is always on: the server makes
 * the token on the first page load (src/app/layout.tsx → server/onboarding.ts)
 * and again whenever the file is missing. Settings → Connection shows and rotates it.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

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
	writeFileAtomic(TOKEN_FILE, token, 0o600);
	return token;
}

/** The token, made first if the file is missing. */
export function ensureMcpToken(): string {
	return readMcpToken() ?? writeNewMcpToken();
}
