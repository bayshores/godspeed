// The agent folder's generated files and commands: each case lists its inputs beside the output
// so the Rust test can run them again.
import { claudeSettings, copyCommand, mcpJson, savedStartCommands, shortFolder, startScript, startScriptPath, usableFolder, usableStartCommand, type StartCommands } from "../../../../src/shared/core/agent-folder.ts";

const FOLDERS = ["/Users/a/godspeed", "/Users/a/godspeed/", "/Users/a/my folder/godspeed", "C:\\Users\\a\\godspeed", "C:\\Users\\a\\godspeed\\", "/Users/a/📚/godspeed", "/Users/a/it's", 'a"b', "relative", "/a\nb", "/a`b", "/a$b", "", "/", "D:\\", "D:/x"];
const PLATFORMS = ["darwin", "win32", "linux"] as const;
const AGENTS = ["claude", "codex"] as const;
const TARGETS = ["claude", "claude-backup", "codex"] as const;

/** Own commands as a learner might save them: a launcher, a variable first, a quoted path, odd characters. */
const COMMANDS: StartCommands[] = [
	{},
	{ claude: "standardcompute launch claude --" },
	{ codex: "standardcompute launch codex --" },
	{ claude: "ANTHROPIC_BASE_URL=https://example.test claude", codex: '"/opt/my tools/codex"' },
	{ claude: "./bin/claude-wrap.sh --x 'a b' $HOME `id` \"q\" & | ; %PATH%", codex: "  codex\tnext" },
	{ claude: "😀 launch" },
];

export default {
	"agent folder text": () =>
		FOLDERS.map((folder) => {
			const usable = usableFolder(folder);
			return {
				folder,
				usable,
				short: [shortFolder(folder, "/Users/a"), shortFolder("/Users/a", "/Users/a"), shortFolder("/Users/ab/x", "/Users/a")],
				platforms: usable
					? Object.fromEntries(
							PLATFORMS.map((p) => [
								p,
								{
									mcp: mcpJson(folder, p),
									settings: claudeSettings(folder, p),
									paths: Object.fromEntries(TARGETS.map((t) => [t, startScriptPath(folder, t, p)])),
									commands: COMMANDS.map((commands) => ({
										commands,
										copy: Object.fromEntries(AGENTS.map((a) => [a, copyCommand(a, folder, "/Users/a", p, commands)])),
										scripts: Object.fromEntries(TARGETS.map((t) => [t, startScript(t, folder, p, commands)])),
									})),
								},
							]),
						)
					: null,
			};
		}),
	"start commands": () => {
		const commands = ["", "claude", "standardcompute launch claude --", "a\nb", "a\rb", "x".repeat(300), "x".repeat(301), "😀".repeat(150), "😀".repeat(151), " padded "];
		const saved = [
			{ claude: "a b", codex: "", other: "x" },
			{ claude: "a\nb", codex: 3 },
			{ codex: "c", claude: "a" },
			"claude",
			null,
			["a"],
			{ claude: "x".repeat(301), codex: " c " },
		];
		return {
			usable: commands.map((command) => ({ command, output: usableStartCommand(command) })),
			saved: saved.map((raw) => ({ raw, output: savedStartCommands(raw) })),
		};
	},
};
