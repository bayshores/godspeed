/**
 * Reads TypeScript source for the checks in this folder: finds the files and parses them with the
 * `typescript` package, with no type check.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Every `.ts` and `.tsx` file under a folder, as full paths. */
export function tsFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return tsFiles(full);
		return /\.tsx?$/.test(entry.name) ? [full] : [];
	});
}

/** A file's syntax tree. `text` stands in for the file's content, as a check's made-up cases do. */
export function parseTs(file: string, text = readFileSync(file, "utf-8")): ts.SourceFile {
	return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** The tokens of a syntax tree, doc comment nodes left out (their text is a comment). */
export function tsTokens(node: ts.Node, source: ts.SourceFile, out: ts.Node[] = []): ts.Node[] {
	if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return out;
	const children = node.getChildren(source);
	if (children.length === 0 && node.getText(source) !== "") out.push(node);
	for (const child of children) tsTokens(child, source, out);
	return out;
}
