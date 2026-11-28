// Points git at .githooks in the main checkout, so every worktree runs the same hooks whatever
// branch it has out. `npm install` runs this.
import { execFileSync } from "node:child_process";
import path from "node:path";

function gitDir() {
	try {
		return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		// A source archive, or a folder git refuses to read: there is no checkout to give hooks to.
		return undefined;
	}
}

const dir = gitDir();
if (dir) execFileSync("git", ["config", "core.hooksPath", path.join(path.dirname(dir), ".githooks")], { stdio: "inherit" });
