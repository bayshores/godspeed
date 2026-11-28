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
