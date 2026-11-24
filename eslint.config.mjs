import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

/**
 * ESLint with one job here: enforce the import law (docs/architecture/02-layers-and-the-import-law.md).
 * It is not a style linter.
 *
 *   src/frontend/**   imports only "@/shared/core" (the pure core barrel)
 *   src/frontend/**   talks to the server only through lib/api.ts and keeps browser
 *                     storage only through lib/storage.ts (AGENTS.md, "One owner, one way")
 *   src/frontend/**   opens no right-click menu: every action has a visible control
 *
 * tests/ and scripts/ are outside the law.
 */

const FRONTEND_MESSAGE =
	"The frontend imports ONLY the pure core barrel: `from \"@/shared/core\"` (architecture: docs/architecture/02-layers-and-the-import-law.md).";

const FETCH_MESSAGE = "Use `send` or `getJson` from lib/api.ts. If a request cannot (a stream, a download), add the file to FETCH_ALLOWED in eslint.config.mjs with the reason.";
const STORAGE_MESSAGE = "Use `readStorage` and `writeStorage` from lib/storage.ts: they never throw in a private window.";
const CONTEXT_MENU_MESSAGE = "A right-click menu hides its actions. Give each action a visible control (a key, a row's More key) instead.";

const fetchGlobals = [{ name: "fetch", message: FETCH_MESSAGE }];
const fetchProperties = ["window", "globalThis"].map((object) => ({ object, property: "fetch", message: FETCH_MESSAGE }));
const storageGlobals = ["localStorage", "sessionStorage"].map((name) => ({ name, message: STORAGE_MESSAGE }));
const storageProperties = ["window", "globalThis"].flatMap((object) =>
	["localStorage", "sessionStorage"].map((property) => ({ object, property, message: STORAGE_MESSAGE })),
);

// The only files outside lib/api.ts that may call the global fetch, and why.
// (index.html also sends the first /api/boot request, before any module loads; eslint does not read it.)
const FETCH_ALLOWED = [
	// The chat session's own transport: it reads the turn's stream, and its tests inject a fake fetch.
	"src/frontend/components/session-core.ts",
	// Reads a PDF's bytes, not JSON.
	"src/frontend/components/cheat-sheet/pdf.ts",
	// Saves a lesson's markdown as a file: a download, not JSON.
	"src/frontend/components/lessons/lesson-menu.tsx",
];

export default defineConfig([
	globalIgnores(["node_modules/**", "data/**", "scripts/**", "dist/**", "dist-ui/**", ".claude/**", "crates/**", "target/**", ".stage/**", ".dev-resources/**"]),
	{
		files: ["**/*.{js,mjs,ts,tsx}"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { ecmaVersion: "latest", sourceType: "module" },
		},
		plugins: { import: importPlugin },
		settings: {
			"import/resolver": { typescript: { alwaysTryTypes: true } },
			// Lets the import rules read .ts/.tsx dependencies (no-cycle needs it).
			"import/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
		},
		rules: {
			"import/no-restricted-paths": [
				"error",
				{
					zones: [
						{
							target: "./src/frontend",
							from: "./src/shared/core",
							except: ["./index.ts"],
							message: FRONTEND_MESSAGE,
						},
					],
				},
			],
		},
	},
	// Requests and storage each have one home in the browser code.
	{
		files: ["src/frontend/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-globals": ["error", ...fetchGlobals, ...storageGlobals],
			"no-restricted-properties": ["error", ...fetchProperties, ...storageProperties],
			"no-restricted-syntax": ["error", { selector: 'JSXAttribute[name.name="onContextMenu"]', message: CONTEXT_MENU_MESSAGE }],
		},
	},
	{
		files: ["src/frontend/lib/api.ts", ...FETCH_ALLOWED],
		rules: {
			"no-restricted-globals": ["error", ...storageGlobals],
			"no-restricted-properties": ["error", ...storageProperties],
		},
	},
	{
		files: ["src/frontend/lib/storage.ts"],
		rules: {
			"no-restricted-globals": ["error", ...fetchGlobals],
			"no-restricted-properties": ["error", ...fetchProperties],
		},
	},
	// No import cycles in src/ (the code quality contract in AGENTS.md).
	{
		files: ["src/**/*.{js,mjs,ts,tsx}"],
		rules: { "import/no-cycle": "error" },
	},
]);
