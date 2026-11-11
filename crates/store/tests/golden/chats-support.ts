import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PATHS } from "../../../../src/backend/config.ts";

const mutablePaths = PATHS as { chats: string };

/** Runs `body` with the store pointed at a fresh folder, then restores it. */
export function inFolder<T>(body: (dir: string) => T): T {
	const saved = mutablePaths.chats;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chats-golden-"));
	mutablePaths.chats = dir;
	try {
		return body(dir);
	} finally {
		mutablePaths.chats = saved;
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
