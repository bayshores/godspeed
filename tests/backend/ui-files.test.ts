/**
 * Every path outside /api and /pdfjs gets the built UI (src/app/[[...path]],
 * src/backend/server/ui-files.ts): a path with a file extension is that
 * file, any other path is index.html.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ui-files-"));
const originalCwd = process.cwd();
// The built UI the catch-all serves: ui/ beside the server (the cwd).
const uiDir = path.join(scratch, "ui");
fs.mkdirSync(path.join(uiDir, "assets"), { recursive: true });
fs.writeFileSync(path.join(uiDir, "index.html"), "<!doctype html><div id=root></div>");
fs.writeFileSync(path.join(uiDir, "assets", "index-abc.js"), "console.log(1)");
fs.writeFileSync(path.join(uiDir, "icon.png"), "png");
fs.writeFileSync(path.join(uiDir, "notes.xyz"), "other");
fs.writeFileSync(path.join(scratch, "secret.png"), "outside");
process.chdir(scratch);
after(() => {
	process.chdir(originalCwd);
	fs.rmSync(scratch, { recursive: true, force: true });
});

const uiRoute = await import("../../src/app/[[...path]]/route.ts");

const read = async (parts?: string[]) => {
	const res = await uiRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ path: parts }) });
	return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), body: await res.text() };
};

describe("the built UI", () => {
	it("a screen's address gets index.html, never cached", async () => {
		for (const parts of [undefined, ["chat", "chat_abc"], ["class", "deadline", "ddl_1", "cheat-sheet"]]) {
			const page = await read(parts);
			assert.equal(page.status, 200, String(parts));
			assert.equal(page.type, "text/html; charset=utf-8");
			assert.equal(page.cache, "no-cache");
			assert.match(page.body, /id=root/);
		}
	});

	it("built files: hashed assets cache forever, others revalidate, unknown types are bytes", async () => {
		const js = await read(["assets", "index-abc.js"]);
		assert.deepEqual([js.status, js.type, js.cache], [200, "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"]);
		const icon = await read(["icon.png"]);
		assert.deepEqual([icon.status, icon.type, icon.cache], [200, "image/png", "no-cache"]);
		const other = await read(["notes.xyz"]);
		assert.deepEqual([other.status, other.type, other.body], [200, "application/octet-stream", "other"]);
	});

	it("a missing file, an unknown API path or a path outside ui/ is a 404 that is never stored", async () => {
		for (const parts of [["assets", "gone.js"], ["no", "such.page"], ["api", "nope"], ["api"], ["..", "secret.png"]]) {
			const res = await read(parts);
			assert.deepEqual([res.status, res.cache], [404, "no-store"], parts.join("/"));
		}
	});
});
