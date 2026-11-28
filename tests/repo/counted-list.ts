/** A check that counts its exceptions per file: the app's source files and the list they are held against. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

/** Every .ts and .tsx file under a folder. */
function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return /\.tsx?$/.test(entry.name) ? [full] : [];
	});
}

/**
 * What `find` reads out of each file of src/frontend, held against the counts in
 * tests/repo/exceptions/<list>.json: a file with more than its count fails (`fix` says what to do),
 * and so does a listed file with fewer, so the list only shrinks.
 */
export function assertWithinList(list: string, find: (source: string) => string[], fix: string): void {
	const allowed = JSON.parse(readFileSync(path.join(root, `tests/repo/exceptions/${list}.json`), "utf-8")) as Record<string, number>;
	const found: Record<string, string[]> = {};
	for (const file of sourceFiles(path.join(root, "src/frontend"))) {
		const own = find(readFileSync(file, "utf-8"));
		if (own.length > 0) found[path.relative(root, file)] = own;
	}
	for (const [file, own] of Object.entries(found)) assert.ok(own.length <= (allowed[file] ?? 0), `${file}: ${fix}: ${own.join(" | ")}`);
	for (const [file, count] of Object.entries(allowed)) {
		assert.equal(found[file]?.length ?? 0, count, `${file} is listed ${count} times in ${list}.json but has ${found[file]?.length ?? 0}: lower the list`);
	}
}
