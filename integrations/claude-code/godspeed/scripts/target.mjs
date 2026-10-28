/**
 * Where the running godspeed app is, and its access token. Shared by the
 * MCP connector (connect.mjs) and the background waiter (wait-for-work.mjs).
 *
 * Where it looks (first match wins):
 *   URL:   $GODSPEED_MCP_URL → <data>/mcp-endpoint.json → http://127.0.0.1:47613/api/mcp
 *   Token: $GODSPEED_MCP_TOKEN → <data>/mcp-token
 *   <data>: $GODSPEED_DATA_DIR → the desktop app's data folder for this OS
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:47613/api/mcp";

function dataDir() {
	if (process.env.GODSPEED_DATA_DIR) return process.env.GODSPEED_DATA_DIR;
	const home = os.homedir();
	if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "godspeed", "data");
	if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "godspeed", "data");
	return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "godspeed", "data");
}

function readText(file) {
	try {
		return fs.readFileSync(file, "utf8").trim();
	} catch {
		return null;
	}
}

/** Read fresh on every call: the app may restart on a new port, or the token may be rotated. */
export function target() {
	const dir = dataDir();
	let url = process.env.GODSPEED_MCP_URL;
	if (!url) {
		try {
			url = JSON.parse(readText(path.join(dir, "mcp-endpoint.json")) ?? "null")?.url;
		} catch {
			url = undefined;
		}
	}
	return { url: url || DEFAULT_URL, token: process.env.GODSPEED_MCP_TOKEN || readText(path.join(dir, "mcp-token")) };
}

export const NO_TOKEN = "godspeed's access token was not found. Open the godspeed app once (it makes the token when it starts), then try again.";
