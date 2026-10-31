/**
 * The godspeed folder on disk (src/core/agent-folder.ts has the pure
 * parts). Setting it up writes the agent's instructions, its connection and
 * its start scripts there; the app refreshes them once per start, so an
 * update reaches them. Which folder is used, and whether the one-time
 * "godspeed has its own folder now" notice was seen, live in
 * <data>/agent-folder.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PATHS } from "../config.ts";
import {
	claudeSettings,
	copyCommand,
	mcpJson,
	shortFolder,
	startScript,
	startScriptPath,
	usableFolder,
	type FolderAgent,
	type OldSetup,
	type Platform,
} from "../core/agent-folder.ts";
import { writeFileAtomic } from "../store/write-file-atomic.ts";
import { oldSetup, removeOldSetup } from "./old-setup.ts";

const STATE_FILE = path.join(PATHS.data, "agent-folder.json");
const TEMPLATE = path.join(process.cwd(), "src", "server", "agent-folder-files");
const AGENTS: FolderAgent[] = ["claude", "codex"];
/** Images the waiter saved for the agent are kept this long. */
const IMAGE_DAYS = 7;

interface FolderState {
	folder?: string;
	noticeSeen?: boolean;
}

interface AgentFolderView {
	folder: string;
	/** "~/godspeed" */
	short: string;
	/** Set up: its connector is there. */
	exists: boolean;
	/** What "Copy the command" copies, per agent. */
	commands: Record<FolderAgent, string>;
	/** The old setup still left once the folder is set up (the first-time
	 *  notice covers people without a folder). */
	oldSetup: OldSetup;
}

/** A folder that can't be used, in words for the learner. */
export class AgentFolderError extends Error {}

function platform(): Platform {
	return process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
}

function readState(): FolderState {
	try {
		const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as FolderState;
		return {
			...(typeof raw.folder === "string" && usableFolder(raw.folder) ? { folder: raw.folder } : {}),
			...(raw.noticeSeen === true ? { noticeSeen: true } : {}),
		};
	} catch {
		return {};
	}
}

function writeState(state: FolderState): void {
	fs.mkdirSync(PATHS.data, { recursive: true });
	writeFileAtomic(STATE_FILE, `${JSON.stringify(state, null, "\t")}\n`);
}

function agentFolder(): string {
	return readState().folder ?? path.join(os.homedir(), "godspeed");
}

export function agentFolderView(folder = agentFolder()): AgentFolderView {
	const home = os.homedir();
	const exists = fs.existsSync(path.join(folder, ".godspeed", "connect.mjs"));
	return {
		folder,
		short: shortFolder(folder, home),
		exists,
		commands: { claude: copyCommand("claude", folder, home, platform()), codex: copyCommand("codex", folder, home, platform()) },
		oldSetup: exists ? oldSetup() : { plugin: false, codex: false },
	};
}

/** Write a file only when it changed, so a refresh leaves the folder alone. */
function put(file: string, content: string, mode?: number): void {
	let same = false;
	try {
		same = fs.readFileSync(file, "utf8") === content;
	} catch {
		/* new file */
	}
	if (!same) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		writeFileAtomic(file, content);
	}
	if (mode !== undefined) fs.chmodSync(file, mode);
}

function template(name: string): string {
	return fs.readFileSync(path.join(TEMPLATE, name), "utf8");
}

function dropOldImages(folder: string): void {
	const dir = path.join(folder, ".godspeed", "images");
	const cutoff = Date.now() - IMAGE_DAYS * 86_400_000;
	for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
		const file = path.join(dir, name);
		if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
	}
}

function writeFolder(folder: string): void {
	const p = platform();
	const dot = path.join(folder, ".godspeed");
	put(path.join(folder, "CLAUDE.md"), template("CLAUDE.md"));
	put(path.join(folder, "AGENTS.md"), template("AGENTS.md"));
	put(path.join(folder, ".claude", "skills", "setup-classes", "SKILL.md"), template("setup-classes.md"));
	put(path.join(folder, ".mcp.json"), mcpJson(folder, p));
	for (const script of ["connect.mjs", "target.mjs", "wait-for-work.mjs", "forget.mjs"]) put(path.join(dot, script), template(script));
	put(path.join(dot, "package.json"), `${JSON.stringify({ private: true, type: "module", version: process.env.LH_VERSION ?? "0.0.0" }, null, "\t")}\n`);
	put(path.join(dot, "claude-settings.json"), claudeSettings(folder, p));
	for (const agent of AGENTS) put(startScriptPath(folder, agent, p), startScript(agent, folder, p), 0o755);
	dropOldImages(folder);
}

/** Make (or update) the folder, remember it, and clear out the old
 *  setup. Throws AgentFolderError when the folder can't be used. */
export function setUpAgentFolder(folder = agentFolder()): AgentFolderView {
	if (!usableFolder(folder)) throw new AgentFolderError("Pick a folder whose name has no quotes or $ signs in it.");
	try {
		writeFolder(folder);
	} catch (err) {
		throw new AgentFolderError(`Couldn't write to ${folder}: ${(err as Error).message}`);
	}
	removeOldSetup();
	writeState({ ...readState(), folder, noticeSeen: true });
	return agentFolderView(folder);
}

let refreshed = false;

/** Once per app start: bring an existing folder's files up to this version. */
export function refreshAgentFolder(): void {
	if (refreshed) return;
	refreshed = true;
	const folder = agentFolder();
	if (!agentFolderView(folder).exists) return;
	try {
		writeFolder(folder);
	} catch (err) {
		console.error("[agent-folder] refresh failed:", err);
	}
}

/** The agent someone set up the old way (the plugin, or the Codex config)
 *  uses, while they haven't seen the "godspeed has its own folder now"
 *  notice; otherwise null. */
export function folderNoticeAgent(): FolderAgent | null {
	if (readState().noticeSeen || agentFolderView().exists) return null;
	const old = oldSetup();
	return old.plugin ? "claude" : old.codex ? "codex" : null;
}

export function dismissFolderNotice(): void {
	writeState({ ...readState(), noticeSeen: true });
}
