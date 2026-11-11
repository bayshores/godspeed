// The jobs package against the TypeScript: the activity feed and the lazy recovery sweep over
// synthetic lessons and jobs, and what aborting and acknowledging leave in job records. Each case
// runs jobs.run.ts in its own process over a fresh data folder (the job store fixes its folder
// when it loads), so nothing here touches a real data folder.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(here, "../../../../node_modules/.bin/tsx");

function run(which: string): unknown {
	const data = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-golden-"));
	try {
		const out = execFileSync(tsx, [path.join(here, "jobs.run.ts"), which], {
			env: { ...process.env, LH_DATA_DIR: data, HOME: data, NODE_ENV: "production" },
			encoding: "utf8",
		});
		return JSON.parse(out);
	} finally {
		fs.rmSync(data, { recursive: true, force: true });
	}
}

export default {
	"feed and sweep": () => run("feed"),
	"aborts and acknowledgements": () => run("records"),
};
