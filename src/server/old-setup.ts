/**
 * The old ways godspeed loaded, which work in every folder instead of only
 * the godspeed folder: the retired Claude Code plugin and the server block
 * once pasted into Codex's config. Finding what is left of them, and
 * removing it. `claude plugin uninstall` leaves the plugin's files behind,
 * and a project that switched the plugin on still loads them, so the app
 * removes the files and the plugin's entries itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withoutJsonEntry, withoutOldCodexServer, type OldSetup } from "../core/agent-folder.ts";
import { writeFileAtomic } from "../store/write-file-atomic.ts";

const PLUGIN = "godspeed@godspeed";
const MARKETPLACE = "godspeed";

function pluginsDir(): string {
	return path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "plugins");
}

/** Claude Code's plugin lists, each with where godspeed's entry sits. */
function pluginLists(): [file: string, keys: [...string[], string]][] {
	const dir = pluginsDir();
	return [
		[path.join(dir, "installed_plugins.json"), ["plugins", PLUGIN]],
		[path.join(dir, "known_marketplaces.json"), [MARKETPLACE]],
	];
}

/** The plugin's downloaded files and its marketplace copy. */
function pluginFolders(): string[] {
	const dir = pluginsDir();
	return [path.join(dir, "cache", MARKETPLACE), path.join(dir, "marketplaces", MARKETPLACE)];
}

function codexConfigFile(): string {
	return path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "config.toml");
}

function readText(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
}

export function oldSetup(): OldSetup {
	const listed = pluginLists().some(([file, keys]) => {
		const text = readText(file);
		return text !== null && withoutJsonEntry(text, keys) !== null;
	});
	const codex = readText(codexConfigFile());
	return {
		plugin: listed || pluginFolders().some((dir) => fs.existsSync(dir)),
		codex: codex !== null && withoutOldCodexServer(codex) !== null,
	};
}

/** Remove what is left of both. Open chats keep the plugin until they restart. */
export function removeOldSetup(): void {
	for (const dir of pluginFolders()) fs.rmSync(dir, { recursive: true, force: true });
	for (const [file, keys] of pluginLists()) {
		const text = readText(file);
		const kept = text === null ? null : withoutJsonEntry(text, keys);
		if (kept !== null) writeFileAtomic(file, kept);
	}
	const file = codexConfigFile();
	const toml = readText(file);
	const kept = toml === null ? null : withoutOldCodexServer(toml);
	if (kept !== null) writeFileAtomic(file, kept);
}
