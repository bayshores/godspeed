/**
 * The page's idea of window.lh (desktop-env.tsx) and the shell's shim.js
 * must name the same members, in window.lh, window.lh.terminals and window.lh.terminalWindow.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");
const declared = read("../../src/frontend/components/desktop-env.tsx");
const shim = read("../../crates/shell/src/shim.js");

/** The text between the line that opens a block and the first later line that closes it. */
function block(text: string, open: string, close: string): string {
	const start = text.indexOf(open);
	assert.ok(start >= 0, `no "${open.trim()}" found`);
	const end = text.indexOf(close, start + open.length);
	assert.ok(end >= 0, `no "${close.trim()}" after "${open.trim()}"`);
	return text.slice(start + open.length, end);
}

/** The names that begin a line indented by exactly `tabs` tabs: `name:`, `name?:` or `name,`. */
const names = (text: string, tabs: number) => [...text.matchAll(new RegExp(`^\\t{${tabs}}(\\w+)\\??[:,]`, "gm"))].map((m) => m[1]!).sort();

function same(inTypes: string[], inShim: string[], what: string) {
	assert.ok(inTypes.length > 0 && inShim.length > 0, `found no ${what}`);
	assert.deepEqual(inTypes.filter((n) => !inShim.includes(n)), [], `${what} declared in desktop-env.tsx but not defined in shim.js`);
	assert.deepEqual(inShim.filter((n) => !inTypes.includes(n)), [], `${what} defined in shim.js but not declared in desktop-env.tsx`);
}

test("window.lh has the same members in desktop-env.tsx and in shim.js", () => {
	const typed = block(declared, "lh?: {\n", "\n\t\t};");
	const shimmed = block(shim, "window.lh = {\n", "\n\t};");
	const macOnly = [...shim.matchAll(/window\.lh\.(\w+) =/g)].map((m) => m[1]!);
	same(names(typed, 3), [...names(shimmed, 2), ...macOnly].sort(), "window.lh members");
});

test("window.lh.terminals has the same members in desktop-env.tsx and in shim.js", () => {
	const typed = block(declared, "terminals?: {\n", "\n\t\t\t};");
	const shimmed = block(shim, "terminals: {\n", "\n\t\t},");
	same(names(typed, 4), names(shimmed, 3), "window.lh.terminals members");
});

test("window.lh.terminalWindow has the same members in desktop-env.tsx and in shim.js", () => {
	const typed = block(declared, "terminalWindow?: {\n", "\n\t\t\t};");
	const shimmed = block(shim, "terminalWindow: {\n", "\n\t\t},");
	same(names(typed, 4), names(shimmed, 3), "window.lh.terminalWindow members");
});
