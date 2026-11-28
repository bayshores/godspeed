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

/** Every comment of a file with its line, read around the parser's own tokens so a `//` in a string or a regex is never one. */
export function tsComments(source: ts.SourceFile): { line: number; text: string }[] {
	const text = source.getFullText();
	const starts = new Set<number>();
	const comments: { line: number; text: string }[] = [];
	for (const token of [...tsTokens(source, source), source.endOfFileToken]) {
		const at = token.getFullStart();
		for (const range of [...(ts.getTrailingCommentRanges(text, at) ?? []), ...(ts.getLeadingCommentRanges(text, at) ?? [])]) {
			// Only the gap before a token holds comments: JSX text such as `// text` has none.
			if (starts.has(range.pos) || range.end > token.getStart(source)) continue;
			starts.add(range.pos);
			comments.push({ line: source.getLineAndCharacterOfPosition(range.pos).line + 1, text: text.slice(range.pos, range.end) });
		}
	}
	return comments.sort((a, b) => a.line - b.line);
}
