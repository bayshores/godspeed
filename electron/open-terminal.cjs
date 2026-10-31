"use strict";

/**
 * Opens a new terminal window running one of the godspeed folder's start
 * scripts (.godspeed/start-<agent>.<ext>, written by the server). Only those
 * scripts can be run, so the window can't ask for anything else.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const EXTENSION = { darwin: "command", win32: "cmd" };

/** The start script for this agent in this folder, or null when the request isn't one. */
function startScript(folder, agent, platform) {
	if (typeof folder !== "string" || !path.isAbsolute(folder) || (agent !== "claude" && agent !== "codex")) return null;
	const script = path.join(folder, ".godspeed", `start-${agent}.${EXTENSION[platform] ?? "sh"}`);
	try {
		return fs.statSync(script).isFile() ? script : null;
	} catch {
		return null;
	}
}

/** The terminals to try, in order: Terminal on a Mac, a new console on
 *  Windows (Windows Terminal when it is the default), the usual Linux ones,
 *  including GNOME's newer Ptyxis and Console. */
function terminalCandidates(script, platform) {
	if (platform === "darwin") return [["open", ["-a", "Terminal", script]]];
	if (platform === "win32") return [["cmd.exe", ["/c", "start", '""', "cmd.exe", "/k", `"${script}"`]]];
	return [
		["x-terminal-emulator", ["-e", script]],
		["gnome-terminal", ["--", script]],
		["konsole", ["-e", script]],
		["ptyxis", ["--", script]],
		["kgx", ["--", script]],
		["xterm", ["-e", script]],
	];
}

function tryRun([command, args]) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { detached: true, stdio: "ignore", windowsVerbatimArguments: command === "cmd.exe" });
		child.once("error", () => resolve(false));
		child.once("spawn", () => {
			child.unref();
			resolve(true);
		});
	});
}

/** Resolves to null when a terminal opened, or a message saying why not. */
async function openAgentTerminal(folder, agent, platform = process.platform) {
	const script = startScript(folder, agent, platform);
	if (!script) return "The godspeed folder isn't set up yet.";
	for (const candidate of terminalCandidates(script, platform)) if (await tryRun(candidate)) return null;
	return "Couldn't open a terminal. Copy the command and run it in yours.";
}

module.exports = { openAgentTerminal, startScript, terminalCandidates };
