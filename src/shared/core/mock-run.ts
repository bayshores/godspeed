/**
 * RUN EXAMPLES: the program that calls a code question's function on each
 * of its examples, and how what it prints is read. The program is the
 * learner's code with a few lines after it that print one marked line of
 * JSON, so anything the code prints itself stays apart. Pure.
 */
import type { CodeQuestion, MockExample, MockLanguage } from "./mock.ts";

/** How one example went. */
export interface ExampleRun {
	/** What the function returned, as JSON text; absent when it threw. */
	returned?: string;
	/** The error it threw. */
	error?: string;
	passed: boolean;
}

export interface RunOutcome {
	/** One per example, in order; empty when the code never got that far. */
	examples: ExampleRun[];
	/** Why nothing ran: a syntax error, the time limit. */
	error?: string;
	/** What the code printed itself. */
	printed?: string;
}

/** Seconds one run may take. */
export const RUN_SECONDS = 5;
const PRINTED_MAX = 2000;
const ERROR_LINES = 12;

/** The file the program is saved as. */
export const RUN_FILE: Record<MockLanguage, string> = { javascript: "solution.js", python: "solution.py" };

/** What every example says when the learner's code has no such function. */
const noFunctionText = (name: string) => `Your code has no function named ${name}.`;

/**
 * The learner's code, then the lines that call `fn` on every example and
 * print the results after `mark`. Only a function the learner's code
 * defines is called, never a built-in of the same name (Python's exec or
 * open, JavaScript's eval): the examples are the teacher's, so a built-in
 * would run them as code the learner never wrote.
 */
export function runnerSource(code: string, fn: CodeQuestion["fn"], examples: readonly MockExample[], language: MockLanguage, mark: string): string {
	const args = JSON.stringify(examples.map((e) => e.args));
	if (language === "python") {
		return [
			code,
			"",
			"def __godspeed_run():",
			"    import json",
			"    out = []",
			// The module's own names: built-ins live elsewhere.
			`    fn = globals().get(${JSON.stringify(fn.name)})`,
			// A JSON string is also a Python string.
			`    for args in json.loads(${JSON.stringify(args)}):`,
			"        if not callable(fn):",
			`            out.append({"error": ${JSON.stringify(noFunctionText(fn.name))}})`,
			"            continue",
			"        try:",
			`            out.append({"returned": json.dumps(fn(*json.loads(args)))})`,
			"        except Exception as err:",
			'            out.append({"error": type(err).__name__ + ": " + str(err)})',
			`    print("\\n${mark}" + json.dumps(out))`,
			"",
			"__godspeed_run()",
			"",
		].join("\n");
	}
	// Its own names start with __, which no function name may.
	return [
		code,
		";(async () => {",
		"\tconst __out = [];",
		// A global of the same name is a built-in the learner didn't write.
		`\tconst __fn = typeof ${fn.name} === "function" && ${fn.name} !== globalThis.${fn.name} ? ${fn.name} : null;`,
		`\tfor (const __args of ${args}) {`,
		"\t\tif (!__fn) {",
		`\t\t\t__out.push({ error: ${JSON.stringify(noFunctionText(fn.name))} });`,
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\ttry {",
		"\t\t\tconst __text = JSON.stringify(await __fn(...JSON.parse(__args)));",
		'\t\t\t__out.push(__text === undefined ? { error: "It returned nothing." } : { returned: __text });',
		"\t\t} catch (__err) {",
		"\t\t\t__out.push({ error: __err instanceof Error ? `${__err.name}: ${__err.message}` : String(__err) });",
		"\t\t}",
		"\t}",
		`\tconsole.log("\\n${mark}" + JSON.stringify(__out));`,
		"})();",
		"",
	].join("\n");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Two JSON values are the same: object keys in any order, and numbers
 *  within rounding of each other. */
function sameValue(a: unknown, b: unknown): boolean {
	if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
	if (isRecord(a) && isRecord(b)) {
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
	}
	return a === b;
}

function exampleRun(raw: unknown, expected: string): ExampleRun {
	if (!isRecord(raw) || typeof raw.returned !== "string") {
		return { error: isRecord(raw) && typeof raw.error === "string" ? raw.error : "It didn't run.", passed: false };
	}
	try {
		const value: unknown = JSON.parse(raw.returned);
		// One spelling for both languages ("[1,2]", never Python's "[1, 2]").
		return { returned: JSON.stringify(value), passed: sameValue(value, JSON.parse(expected)) };
	} catch {
		return { returned: raw.returned, passed: false };
	}
}

/**
 * What a finished program printed, read: the results after `mark`, each
 * checked against its example, and whatever the code printed before them.
 * With no marked line the code never got to the examples: `stderr`'s last
 * lines say why.
 */
export function readRun(stdout: string, stderr: string, mark: string, examples: readonly MockExample[]): RunOutcome {
	const at = stdout.lastIndexOf(mark);
	const printed = (at < 0 ? stdout : stdout.slice(0, at)).trim().slice(0, PRINTED_MAX);
	const withPrinted = (outcome: RunOutcome): RunOutcome => (printed ? { ...outcome, printed } : outcome);
	let results: unknown;
	try {
		results = at < 0 ? undefined : JSON.parse(stdout.slice(at + mark.length).split("\n")[0]!);
	} catch {
		results = undefined;
	}
	if (!Array.isArray(results)) {
		// Node's own stack frames and version line say nothing about the code.
		const why = stderr
			.split("\n")
			.filter((line) => line.trim() && !/^\s+at .*\bnode:/.test(line) && !/^Node\.js v/.test(line))
			.slice(-ERROR_LINES)
			.join("\n");
		return withPrinted({ examples: [], error: why || "Your code stopped before the examples ran." });
	}
	const list = results as unknown[];
	return withPrinted({ examples: examples.map((e, i) => exampleRun(list[i], e.expected)) });
}
