import * as fs from "node:fs";
import * as path from "node:path";

/** Write a file by temp file + rename in the same folder, so a crash
 *  mid-write leaves the old file whole instead of a torn one. */
export function writeFileAtomic(file: string, text: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${crypto.randomUUID().slice(0, 8)}`;
	try {
		fs.writeFileSync(tmp, text, "utf-8");
		fs.renameSync(tmp, file);
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		throw err;
	}
}
