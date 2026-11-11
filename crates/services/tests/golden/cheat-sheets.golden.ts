// The cheat-sheet server code against the TypeScript: the class page and sheet views, a version's
// PDF and a kept file, the refusals an ask gives before anything is kept, rules, Show in Finder,
// a newer PDF in the working folder coming in as a version, and taking the PDF an agent made.
// cheat-sheets.run.ts runs once in its own process over fresh data and home folders (the stores
// fix their folders when they load) and records the folders it started with, each step and its
// answer. Nothing here touches a real data folder.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(here, "../../../../node_modules/.bin/tsx");

function run(): unknown {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sheets-golden-"));
	try {
		const data = path.join(dir, "data");
		const home = path.join(dir, "home");
		fs.mkdirSync(data);
		fs.mkdirSync(home);
		const out = execFileSync(tsx, [path.join(here, "cheat-sheets.run.ts")], {
			env: { ...process.env, LH_DATA_DIR: data, HOME: home, NODE_ENV: "production" },
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		return JSON.parse(out);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

export default {
	"views, reads, rules, folder and taking PDFs": () => run(),
};
