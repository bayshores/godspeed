import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

/**
 * ESLint with one job here: enforce the import law (docs/architecture.md).
 * It is not a style linter.
 *
 *   src/frontend/**   imports only "@/shared/core" (the pure core barrel)
 *
 * tests/ and scripts/ are outside the law.
 */

const FRONTEND_MESSAGE =
	"The frontend imports ONLY the pure core barrel: `from \"@/shared/core\"` (architecture: docs/architecture.md).";

export default defineConfig([
	globalIgnores(["node_modules/**", "data/**", "scripts/**", "dist/**", "dist-ui/**", ".claude/**", "crates/**", "target/**"]),
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
	// No import cycles in src/ (the code quality contract in AGENTS.md).
	{
		files: ["src/**/*.{js,mjs,ts,tsx}"],
		rules: { "import/no-cycle": "error" },
	},
]);
