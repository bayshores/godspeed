import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-coverage-extract-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { POST } = await import("../src/app/api/graph/coverage/extract/route.ts");

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

it("a lesson that does not exist is a 404, not a started run", async () => {
	const res = await POST(new Request("http://localhost/api/graph/coverage/extract", { method: "POST", body: JSON.stringify({ chatId: "chat_deleted" }) }));
	assert.equal(res.status, 404);
	assert.deepEqual(await res.json(), { error: "Not found" });
});
