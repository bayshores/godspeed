/**
 * docs/features.md lists every feature with the control that reaches it. This reads that table
 * and fails when a teacher tool, key action or route is in no row, when a row names something
 * that is gone, when a row's control is no longer in the code, or when a feature only the teacher
 * makes is not drawn by a layout screen before it exists.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { SCREENS } from "../../scripts/layout-screens.mjs";
import { KEYBOARD_ACTIONS } from "../../src/shared/core/keyboard.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf-8");

interface Row {
	feature: string;
	home: string;
	shownBy: string;
	madeBy: string;
	covers: string[];
	cells: number;
}

const backticked = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** The rows of the table whose header starts with "| Feature |". */
function rows(): Row[] {
	const lines = read("docs/features.md").split("\n");
	const start = lines.findIndex((line) => line.startsWith("| Feature |"));
	assert.ok(start >= 0, "docs/features.md has no table headed Feature");
	const out: Row[] = [];
	for (const line of lines.slice(start + 2)) {
		if (!line.startsWith("|")) break;
		const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
		out.push({ feature: cells[0]!, home: cells[2] ?? "", shownBy: cells[3] ?? "", madeBy: cells[4] ?? "", covers: backticked(cells[5] ?? ""), cells: cells.length });
	}
	assert.ok(out.length > 50, "found too few rows; the reader is broken");
	return out;
}

const tools = (JSON.parse(read("crates/server/src/mcp/tools.json")) as { name: string }[]).map((tool) => tool.name);
const actions = KEYBOARD_ACTIONS.map((action) => action.id);
const routes = [...read("src/frontend/routes/router.tsx").matchAll(/\bpath:\s*"([^"]*)"/g)].map((m) => m[1]!);

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return /\.tsx?$/.test(entry.name) ? [full] : [];
	});
}

/**
 * Every quoted text on a line that sets a test id: `data-testid="x"`, `testid="x"`,
 * `testIds={{ key: "x" }}`, `testid: "x"` and `data-testid={on ? "x" : "y"}`. A name built with
 * a template (`space-file-${id}`) is never found, so a row cannot name one.
 */
const testIds = new Set(
	sourceFiles(path.join(root, "src/frontend"))
		.flatMap((file) => readFileSync(file, "utf-8").split("\n"))
		.filter((line) => /test-?ids?/i.test(line))
		.flatMap((line) => [...line.matchAll(/"([^"`${}]+)"/g)].map((m) => m[1]!)),
);

/** The screen of `npm run layout` with this name, as text, or undefined. */
const screenText = (name: string) => {
	const screen = SCREENS.find((s: { name: string }) => s.name === name);
	return screen && JSON.stringify(screen);
};
const names = (text: string, id: string) => new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`).test(text);
const homeId = (row: Row) => (row.home.startsWith("none:") ? undefined : backticked(row.home)[0]);

describe("docs/features.md", () => {
	it("has six cells in every row and a made by that is learner or teacher", () => {
		const bad = rows().filter((row) => row.cells !== 6 || (row.madeBy !== "learner" && row.madeBy !== "teacher"));
		assert.deepEqual(
			bad.map((row) => row.feature),
			[],
			"These rows need exactly six cells (a | inside a cell splits it) and Made by learner or teacher.",
		);
	});

	it("covers every teacher tool, key action and route", () => {
		const covered = new Set(rows().flatMap((row) => row.covers));
		const missing = [
			...tools.filter((name) => !covered.has(name)).map((name) => `the tool ${name}`),
			...actions.filter((name) => !covered.has(name)).map((name) => `the key action ${name}`),
			...routes.filter((name) => !covered.has(name)).map((name) => `the route ${name}`),
		];
		assert.deepEqual(missing, [], "Put each in the Covers cell of the row of the feature it is the home of, in backticks (a tool only the teacher itself uses goes in the row \"The agent's own tools\").");
	});

	it("names in Covers only what exists", () => {
		const known = new Set([...tools, ...actions, ...routes]);
		const unknown = rows().flatMap((row) => row.covers.filter((token) => !known.has(token)).map((token) => `${token} (row "${row.feature}")`));
		assert.deepEqual(unknown, [], "These are no teacher tool, key action or route. Fix the typo, or remove the name if the tool, key or route is gone.");
	});

	it("gives every row a Home that is none with a reason or a test id found in the code", () => {
		const bad = rows().flatMap((row) => {
			if (row.home.startsWith("none:")) return row.home.slice(5).trim() === "" ? [`"${row.feature}": none needs a reason`] : [];
			const ids = backticked(row.home);
			if (ids.length !== 1 || row.home !== `\`${ids[0]}\``) return [`"${row.feature}": Home must be one backticked test id or "none: reason"`];
			return testIds.has(ids[0]!) ? [] : [`"${row.feature}": no test id "${ids[0]}" in src/frontend`];
		});
		assert.deepEqual(bad, [], "A Home control that is gone is no home: name the control that reaches the feature now, or write none with the reason.");
	});

	it("proves with a layout screen that a Home control is drawn", () => {
		const bad = rows().flatMap((row) => {
			const id = homeId(row);
			if (row.shownBy === "") return row.madeBy === "teacher" && id ? [`"${row.feature}": made by the teacher, so Shown by must name a screen that draws ${id}`] : [];
			const text = screenText(row.shownBy);
			if (text === undefined) return [`"${row.feature}": no screen named "${row.shownBy}" in scripts/layout-screens.mjs`];
			if (!id) return [`"${row.feature}": Shown by is set but Home has no test id`];
			return names(text, id) ? [] : [`"${row.feature}": the screen "${row.shownBy}" does not mention ${id}`];
		});
		assert.deepEqual(bad, [], "Name a screen of scripts/layout-screens.mjs whose entry opens or waits for the Home control. A screen that does not draw it proves nothing.");
	});
});
