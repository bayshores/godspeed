// The spaces package against the TypeScript: source ids, folder names, the space card, the
// list_spaces and read_space tools, and the shortcuts in a godspeed folder's spaces/ over three
// synthetic spaces. spaces.run.ts runs in its own process over a fresh folder (the stores fix
// their folders when they load), so nothing here touches a real data folder.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(here, "../../../../node_modules/.bin/tsx");

function run(): unknown {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaces-golden-"));
	try {
		const data = path.join(dir, "data");
		const home = path.join(dir, "home");
		fs.mkdirSync(data);
		fs.mkdirSync(home);
		const out = execFileSync(tsx, [path.join(here, "spaces.run.ts")], {
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
	"ids, names, cards, tools and shortcuts": () => run(),
};
