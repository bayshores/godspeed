/**
 * build-claude-helper.mjs — bundle godspeed's Claude helper into one file.
 *
 * crates/runtime/src/claude/claude-helper.mjs, with the Agent SDK and the MCP SDK it imports,
 * becomes one ESM file that the app runs with the learner's own Node. The SDK's own Claude Code
 * (its per-platform package) is not part of it: the SDK looks that package up by a name it builds
 * at run time, which a bundler cannot follow, and only when no `claude` is given, while the helper
 * always gives the learner's own.
 *
 * Run directly, it writes .stage/agent/claude-helper.mjs, which the app bundle ships as
 * agent/claude-helper.mjs (crates/shell/tauri.bundle.conf.json). stage-app.mjs and
 * dev-resources.mjs call `buildClaudeHelper` with their own folder.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "crates", "runtime", "src", "claude", "claude-helper.mjs");
/** The oldest Node the Agent SDK runs on. */
const NODE_TARGET = "node18";

/** Writes the bundled helper to `outfile`. */
export async function buildClaudeHelper(outfile) {
	await esbuild.build({
		entryPoints: [SOURCE],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: NODE_TARGET,
		legalComments: "eof",
		logLevel: "warning",
	});
	const size = fs.statSync(outfile).size;
	console.log(`[build-claude-helper] wrote ${path.relative(ROOT, outfile)} (${Math.round(size / 1024)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await buildClaudeHelper(path.join(ROOT, ".stage", "agent", "claude-helper.mjs"));
}
