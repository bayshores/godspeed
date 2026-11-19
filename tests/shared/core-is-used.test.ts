/**
 * Everything the core exports must have a user that runs in the browser:
 * a file under src/frontend, or another file of the core. A name only tests
 * use is logic the server owns, and knip cannot see it because tests count as
 * users. Names are found by reading the source, with no type check.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const coreDir = path.join(root, "src/shared/core");
const barrels = ["index.ts", "contracts.ts"].map((name) => path.join(coreDir, name));

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return /\.tsx?$/.test(entry.name) ? [full] : [];
	});
}

const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, "utf-8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const isExported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** The names a file exports, each with the file that declares it, following `export *`. */
function exportsOf(file: string, seen = new Set<string>()): Map<string, string> {
	const out = new Map<string, string>();
	if (seen.has(file)) return out;
	seen.add(file);
	for (const node of parse(file).statements) {
		if (ts.isExportDeclaration(node)) {
			if (node.moduleSpecifier && !node.exportClause) {
				const target = path.resolve(path.dirname(file), (node.moduleSpecifier as ts.StringLiteral).text);
				for (const [name, from] of exportsOf(target, seen)) out.set(name, from);
			} else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
				for (const el of node.exportClause.elements) out.set(el.name.text, file);
			}
		} else if (isExported(node)) {
			if (ts.isVariableStatement(node)) {
				for (const decl of node.declarationList.declarations) if (ts.isIdentifier(decl.name)) out.set(decl.name.text, file);
			} else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
				out.set(node.name.text, file);
			}
		}
	}
	return out;
}

/** Every identifier written in a file, comments and strings left out. */
function identifiersOf(file: string): Set<string> {
	const names = new Set<string>();
	const visit = (node: ts.Node) => {
		if (ts.isIdentifier(node)) names.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(parse(file));
	return names;
}

/** Browser logic whose single steps or measuring tool tests need to reach, with the reason each stays. */
const TESTS_REACH_INSIDE = new Map([
	["restoreMathEscapes", "one step of repairMathForDisplay, which tests pin step by step"],
	["healOverescapedCommands", "one step of repairMathForDisplay, which tests pin step by step"],
	["pdfNote", "the note the browser writes for a PDF it shows before the server saves it; tests build and read that note"],
	["coerceCorrectAnswer", "a grading step the browser runs, pinned case by case"],
	["isCorrect", "a grading step the browser runs, pinned case by case"],
	["contrast", "the WCAG measure behind inkFor; tests use it to check every color the app draws"],
]);

it("every name the core exports is used by the frontend or by another core file", () => {
	const exported = exportsOf(path.join(coreDir, "index.ts"));
	for (const [name, from] of exportsOf(path.join(coreDir, "contracts.ts"))) exported.set(name, from);
	assert.ok(exported.size > 100, "found too few exports; the reader is broken");
	for (const name of TESTS_REACH_INSIDE.keys()) assert.ok(exported.has(name), `${name} is no longer exported: remove it from TESTS_REACH_INSIDE`);

	const users = [...sourceFiles(path.join(root, "src/frontend")), ...sourceFiles(coreDir).filter((file) => !barrels.includes(file))].map((file) => ({ file, names: identifiersOf(file) }));
	const unused = [...exported]
		.filter(([name, from]) => !TESTS_REACH_INSIDE.has(name) && !users.some((user) => user.file !== from && user.names.has(name)))
		.map(([name, from]) => `${name} (${path.relative(root, from)})`);

	assert.deepEqual(
		unused,
		[],
		"Only tests use these names. The Rust server owns that logic: delete the export, or make it private if its own file needs it.",
	);
});
