/**
 * Every class and custom property src/frontend/globals.css defines is used. A class is used when
 * the frontend's code or index.html writes it, or an `@apply` of the stylesheet does. A custom
 * property is used when a `var()` reads it, in the stylesheet, the frontend's code, the shared core
 * or the Rust code (the server sends a topic's color as `var(--lh-ramp-3)`); a theme token
 * is used through its Tailwind utility (`--color-card` by `bg-card`, `--radius-xl` by `rounded-xl`),
 * `--text-xs--line-height` with `--text-xs`, and Tailwind's `--default-transition-*` by any
 * `transition` utility. A name the code builds at run time (`--lh-space-${color}`) makes every
 * name that starts with the part before `${` used. Comments of
 * the stylesheet and of the code count for nothing. Tailwind also reads the files an `@source`
 * line names, so a utility a library's own code writes there is used.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { withoutBlockComments } from "./repo-source.ts";
import { appSources } from "./rust-source.ts";
import { parseTs, tsFiles, tsTokens } from "./ts-source.ts";

const root = path.resolve(import.meta.dirname, "../..");
const LIST = "tests/repo/exceptions/css-unused.json";

/** The utilities each theme namespace makes, as patterns of the utility's name before the token's own part. */
const UTILITIES: [namespace: string, before: string][] = [
	["color", "(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|decoration|divide|from|via|to|accent|caret|placeholder|shadow|inset-shadow|drop-shadow|inset-ring)"],
	["font-weight", "font"],
	["font", "font"],
	["leading", "leading"],
	["radius", "rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?"],
	["text", "text"],
];

type Sheet = { classes: Set<string>; properties: Set<string> };

/** The classes the stylesheet's selectors name, and the custom properties it defines. */
function definedIn(css: string): Sheet {
	const classes = new Set<string>();
	for (const [, selector] of css.matchAll(/([^{};]+)\{/g)) {
		if (selector!.trim().startsWith("@")) continue;
		for (const [, name] of selector!.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(name!);
	}
	return { classes, properties: new Set([...css.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map(([, name]) => name!)) };
}

/** What the code writes: its class names (variants and `/50` opacity taken off), its `var()` reads, and the prefixes it builds names from. */
function usesIn(code: string): { classes: Set<string>; reads: Set<string>; built: string[] } {
	const classes = new Set<string>();
	for (const token of code.split(/[\s"'`{}()[\],;]+/)) {
		const utility = token.replace(/^.*:(?![^[]*\])/, "").replace(/^!|!$/g, "").replace(/\/[\w.]+$/, "");
		if (/^-?[_a-zA-Z][\w-]*$/.test(utility)) classes.add(utility);
	}
	// Tailwind reads one as `var(--lh-gap)` or in short as `gap-(--lh-gap)`, and a script with `getPropertyValue("--font-sans")`.
	const reads = new Set([...code.matchAll(/(?:(?:var|getPropertyValue)\s*|-)\(\s*["'`]?(--[\w-]+)/g)].map(([, name]) => name!));
	const built = [...code.matchAll(/(-{0,2}[_a-zA-Z][\w-]*-)\$\{/g)].map(([, prefix]) => prefix!);
	return { classes, reads, built };
}

/** The defined names nothing uses. */
function unused(sheet: Sheet, uses: ReturnType<typeof usesIn>): string[] {
	const builtFrom = (name: string) => uses.built.some((prefix) => name.startsWith(prefix));
	const utilityOf = (property: string) => {
		const token = property.slice(2).replace(/--[\w-]+$/, "");
		const [namespace, before] = UTILITIES.find(([space]) => token.startsWith(`${space}-`)) ?? [];
		if (!namespace) return false;
		const own = token.slice(namespace.length + 1);
		return [...uses.classes].some((name) => new RegExp(`^${before}-${own}$`).test(name));
	};
	// Tailwind's own `--default-transition-*` is what a transition utility given no time of its own takes.
	const defaultOf = (property: string) => property.startsWith("--default-transition-") && [...uses.classes].some((name) => /^transition(-|$)/.test(name));
	const classes = [...sheet.classes].filter((name) => !uses.classes.has(name) && !builtFrom(name)).map((name) => `.${name}`);
	// `--text-xs--line-height` goes with `--text-xs`.
	const properties = [...sheet.properties].filter((name) => !uses.reads.has(name) && !uses.reads.has(name.replace(/(?<=\w)--[\w-]+$/, "")) && !builtFrom(name) && !utilityOf(name) && !defaultOf(name));
	return [...classes, ...properties];
}

/** The files an `@source "<folder>/*.js"` line has Tailwind read for class names, a library's own code among them. */
function sourcesOf(css: string, dir: string): string[] {
	return [...css.matchAll(/@source "([^"]+)\/\*\.js"/g)].flatMap(([, folder]) => {
		const full = path.join(dir, folder!);
		return readdirSync(full)
			.filter((name) => name.endsWith(".js"))
			.map((name) => readFileSync(path.join(full, name), "utf-8"));
	});
}

it("every class and custom property the stylesheet defines is used", () => {
	const dir = path.join(root, "src/frontend");
	const css = withoutBlockComments(readFileSync(path.join(dir, "globals.css"), "utf-8"));
	const code = ["src/frontend", "src/shared/core"].flatMap((folder) =>
		tsFiles(path.join(root, folder)).flatMap((file) => {
			const source = parseTs(file);
			return tsTokens(source, source).map((token) => token.getText(source));
		}),
	);
	const server = appSources().map((source) => source.code);
	const applied = [...css.matchAll(/@apply ([^;]+);/g)].map(([, list]) => list!);
	const sheet = definedIn(css);
	assert.ok(sheet.classes.size > 50 && sheet.properties.size > 100, "found too few classes or properties; the reader is broken");
	const uses = usesIn([...code, ...server, ...applied, readFileSync(path.join(dir, "index.html"), "utf-8"), css, ...sourcesOf(css, dir)].join("\n"));
	const allowed = JSON.parse(readFileSync(path.join(root, LIST), "utf-8")) as Record<string, string>;
	const found = unused(sheet, uses);
	assert.deepEqual(
		found.filter((name) => !(name in allowed)),
		[],
		"src/frontend/globals.css defines these and nothing uses them. Delete them, or use them where they were meant to be.",
	);
	assert.deepEqual(
		Object.keys(allowed).filter((name) => !found.includes(name)),
		[],
		`These are used or gone now: remove them from ${LIST}.`,
	);
});

describe("the stylesheet reader", () => {
	it("finds what a stylesheet defines and the code never uses", () => {
		const sheet = definedIn(
			":root { --lh-gap: 4px; --lh-short: 2px; --lh-read: 1px; --lh-old: 2px; --lh-space-1: red; --background: white; }\n@theme inline { --color-card: var(--background); --color-gone: red; --radius-xl: 8px; --text-ui: 15px; --text-ui--line-height: 1.5; }\n.lh-page { gap: var(--lh-gap); }\n.lh-dead, .lh-card:hover > .lh-row { color: red; }\n",
		);
		const code = '<div className="lh-page hover:bg-card/50 md:rounded-xl text-ui gap-(--lh-short)"><p className={cn("lh-row", x && "lh-card")} style={{ color: `var(--lh-space-${n})` }} /></div>\ncss.getPropertyValue(\n"--lh-read")';
		const uses = usesIn(`${code}\n.lh-page { gap: var(--lh-gap); } --color-card: var(--background);`);
		assert.deepEqual(unused(sheet, uses), [".lh-dead", "--lh-old", "--color-gone"]);
	});

	it("takes comments out, but not a /* inside a string", () => {
		assert.equal(withoutBlockComments('@source "../dist/*.js"; /* gone */ .a { }'), '@source "../dist/*.js";  .a { }');
	});
});
