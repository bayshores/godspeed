import fs from "node:fs";

/** Rename a file that isn't valid JSON, so the next save (which starts from
 *  an empty record) can't overwrite it. The original stays next to it to fix
 *  by hand. Never throws. */
export function setAsideCorrupt(file: string): void {
	try {
		fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
		console.error(`[store] ${file} was not valid JSON; kept it aside`);
	} catch {
		// the read still answers empty
	}
}
