import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

/**
 * ESLint with one job here: enforce the import law (docs/architecture.md).
 * It is not a style linter.
 *
 *   src/frontend/components/**  imports only "@/shared/core" (the pure core barrel)
 *   src/app/**                  imports only "@/shared/core" and "@/backend/server" (the barrels)
 *   src/shared/core/**          never imports src/backend (adapters implement core/ports.ts)
 *   src/backend/agent/**        never imports src/backend/server or src/backend/store
 *                               (its dependencies arrive through factories)
 *
 * tests/, scripts/ and electron/ are outside the law.
 */

const SHELL_MESSAGE =
	"Browser shell imports ONLY the pure core barrel: `from \"@/shared/core\"` (architecture: docs/architecture.md).";
const APP_MESSAGE =
	"src/app/ (transport + server components) imports ONLY the barrels: `@/shared/core` and `@/backend/server` (plus `@/backend/server/settings-read` for the layout's render-time reads) (architecture: docs/architecture.md).";

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
							target: "./src/frontend/components",
							from: "./src/shared/core",
							except: ["./index.ts"],
							message: SHELL_MESSAGE,
						},
						{
							target: "./src/frontend/components",
							from: ["./src/backend/agent", "./src/backend/server", "./src/backend/store"],
							message: SHELL_MESSAGE,
						},
						{
							target: "./src/app",
							from: "./src/shared/core",
							except: ["./index.ts"],
							message: APP_MESSAGE,
						},
						{
							target: "./src/app",
							from: "./src/backend/server",
							// settings-read.ts: a light import for the layout's render-time reads;
							// the full barrel loads the whole server.
							except: ["./index.ts", "./settings-read.ts"],
							message: APP_MESSAGE,
						},
						{
							target: "./src/app",
							from: ["./src/backend/agent", "./src/backend/store"],
							message: APP_MESSAGE,
						},
						{
							target: "./src/shared/core",
							from: ["./src/backend/agent", "./src/backend/server", "./src/backend/store"],
							message:
								"Pure core never imports IO layers (agent/server/store): adapters implement core/ports.ts, and the composition root (src/backend/server/stores.ts) passes them in (architecture: docs/architecture.md).",
						},
						{
							target: "./src/backend/agent",
							from: ["./src/backend/server", "./src/backend/store"],
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
