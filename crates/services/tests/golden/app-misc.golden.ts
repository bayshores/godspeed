// The settings parsers, the prompt segment list, the activity log, the saved-rules code and the
// reading view against the TypeScript. app-misc.run.ts runs once in its own process over fresh
// data and home folders (the stores fix their folders when they load) with a synthetic class.
// Nothing here touches a real data folder.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(here, "../../../../node_modules/.bin/tsx");

type Recorded = Record<string, unknown>;
let recorded: Recorded | undefined;

function run(): Recorded {
	if (recorded) return recorded;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-misc-golden-"));
	try {
		const data = path.join(dir, "data");
		const home = path.join(dir, "home");
		fs.mkdirSync(data);
		fs.mkdirSync(home);
		const out = execFileSync(tsx, [path.join(here, "app-misc.run.ts")], {
			env: { ...process.env, LH_DATA_DIR: data, HOME: home, NODE_ENV: "production" },
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		recorded = JSON.parse(out) as Recorded;
		return recorded;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

export default {
	"settings section bodies": () => run().settingsBodies,
	"prompt segment list": () => run().promptList,
	"activity log": () => run().activity,
	"saved rules": () => run().saved,
	"reading documents": () => run().reading,
};
