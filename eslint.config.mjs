import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

/**
 * ESLint with one job here: ENFORCE THE IMPORT LAW (the shell/core
 * architecture, docs/architecture.md). Everything else stays out of the
 * way — this is not a style linter.
 *
 *   src/components/**  →  "@/core"  (the pure core barrel) — ONLY
 *   src/app/**         →  "@/core" + "@/server" (the server barrel) — ONLY
 *   (the core library = src/core, src/server, src/agent, src/store,
 *   src/utils.ts; components/, app/, lib/ and config.ts are not part of it)
 *   src/core/**    →  never imports src/agent, src/server, src/store (pure
 *                    core: adapters implement core/ports.ts, never the reverse)
 *   src/agent/**   →  never imports src/server, src/store (dependencies —
 *                    the storage ports, the composition — arrive via
 *                    factories/closures from the chat-handler)
 *
 * tests/ and scripts/ are internal — unrestricted.
 */

const SHELL_MESSAGE =
	"Browser shell imports ONLY the pure core barrel: `from \"@/core\"` (architecture: docs/architecture.md).";
const APP_MESSAGE =
	"src/app/ (transport + server components) imports ONLY the barrels: `@/core` and `@/server` (plus `@/server/settings-read` for the layout's render-time reads) (architecture: docs/architecture.md).";

export default defineConfig([
	// electron/** — the desktop shell: plain Node, no framework, outside the
// import law (same rationale as scripts/).
	globalIgnores([".next/**", "node_modules/**", "data/**", "next-env.d.ts", "scripts/**", "electron/**", "dist/**", ".claude/**"]),
	{
		files: ["**/*.{js,mjs,ts,tsx}"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { ecmaVersion: "latest", sourceType: "module" },
		},
		plugins: { "@next/next": nextPlugin, import: importPlugin },
		settings: {
			"import/resolver": { typescript: { alwaysTryTypes: true } },
			// Lets the import rules read .ts/.tsx dependencies (no-cycle needs it).
			"import/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
		},
		rules: {
			...nextPlugin.configs.recommended.rules,
			"import/no-restricted-paths": [
				"error",
				{
					zones: [
						// One zone per `from` dir: the plugin resolves `except` relative to
						// the zone's `from` path, and every exception must sit inside it.
						{
							target: "./src/components",
							from: "./src/core",
							except: ["./index.ts"],
							message: SHELL_MESSAGE,
						},
						{
							target: "./src/components",
							from: ["./src/agent", "./src/server", "./src/store", "./src/utils.ts"],
							message: SHELL_MESSAGE,
						},
						{
							target: "./src/app",
							from: "./src/core",
							except: ["./index.ts"],
							message: APP_MESSAGE,
						},
						{
							target: "./src/app",
							from: "./src/server",
							// settings-read.ts: the light door for the layout's render-time reads
							// (speed plan, owner 2026-10-27) — the full barrel loads the whole server.
							except: ["./index.ts", "./settings-read.ts"],
							message: APP_MESSAGE,
						},
						{
							target: "./src/app",
							from: ["./src/agent", "./src/store", "./src/utils.ts"],
							message: APP_MESSAGE,
						},
						{
							target: "./src/core",
							from: ["./src/agent", "./src/server", "./src/store"],
							message:
								"Pure core never imports IO layers (agent/server/store): adapters implement core/ports.ts, and the composition root (src/server/stores.ts) passes them in (architecture: docs/architecture.md).",
						},
						{
							target: "./src/agent",
							from: ["./src/server", "./src/store"],
							message:
								"The agent layer receives its dependencies (storage ports via factories/closures) — it never imports the server layer or store adapters (architecture: docs/architecture.md).",
						},
					],
				},
			],
		},
	},
	// No import cycles in src/ (the code quality contract in AGENTS.md).
	{
		files: ["src/**/*.{js,mjs,ts,tsx}"],
		rules: { "import/no-cycle": "error" },
	},
]);
