import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { dispositionFileName, saveBlob, saveText } from "../../src/frontend/components/artifacts/download.ts";

/** Runs `body` with the few browser parts the save needs, recording what it did. */
async function saving(body: (log: { clicked: { href: string; download: string }[]; revoked: string[]; blobs: Blob[] }) => void | Promise<void>) {
	const log = { clicked: [] as { href: string; download: string }[], revoked: [] as string[], blobs: [] as Blob[] };
	const realDocument = globalThis.document;
	const realUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
	globalThis.document = { createElement: () => ({ href: "", download: "", click() { log.clicked.push({ href: this.href, download: this.download }); } }) } as unknown as Document;
	URL.createObjectURL = (blob) => (log.blobs.push(blob as Blob), "blob:saved");
	URL.revokeObjectURL = (url) => void log.revoked.push(url);
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		await body(log);
	} finally {
		mock.timers.reset();
		globalThis.document = realDocument;
		URL.createObjectURL = realUrl.create;
		URL.revokeObjectURL = realUrl.revoke;
	}
}

test("saveBlob clicks a download link for the blob and frees the blob after 60 seconds", async () => {
	await saving((log) => {
		saveBlob("notes.md", new Blob(["x"]));
		assert.deepEqual(log.clicked, [{ href: "blob:saved", download: "notes.md" }]);
		mock.timers.tick(59_999);
		assert.deepEqual(log.revoked, []);
		mock.timers.tick(1);
		assert.deepEqual(log.revoked, ["blob:saved"]);
	});
});

test("saveText saves the text with its type", async () => {
	await saving(async (log) => {
		saveText("page.html", "<p>hi</p>", "text/html");
		assert.equal(log.clicked[0]?.download, "page.html");
		assert.equal(log.blobs[0]?.type, "text/html");
		assert.equal(await log.blobs[0]?.text(), "<p>hi</p>");
	});
});

test("the file name comes from the Content-Disposition header, or is null", () => {
	assert.equal(dispositionFileName('attachment; filename="limits-and-continuity.md"'), "limits-and-continuity.md");
	assert.equal(dispositionFileName('attachment; filename="a b.md"'), "a b.md");
	assert.equal(dispositionFileName("attachment"), null);
	assert.equal(dispositionFileName(null), null);
});
