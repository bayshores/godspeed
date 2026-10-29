/**
 * SPEED PLAN PINS (owner-approved 2026-10-27), fix 2 — class PDFs never
 * stall the server:
 *  - the worker-thread reader returns exactly what the in-process reader
 *    did (pdf-text-worker.mjs duplicates pdfExtract's page format)
 *  - the fingerprint is streamed, same value as hashing the whole file
 *  - a PDF's extracted text is saved under its fingerprint and reused when
 *    the file is processed again unchanged; removing the file removes it
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-pdf-worker-"));
process.env.LH_DATA_DIR = TMP_DATA;

const FIXTURE = path.join(import.meta.dirname, "fixtures", "sample-3page.pdf");

const { pdfExtract } = await import("../src/agent/subagents/pdf-ops.ts");
const { fingerprintFile, pdfTextOffThread } = await import("../src/server/class-files.ts");
const server = await import("../src/server/index.ts");
const classesRoute = await import("../src/app/api/classes/route.ts");
const filesRoute = await import("../src/app/api/classes/[id]/files/route.ts");
const fileRoute = await import("../src/app/api/classes/[id]/files/[fileId]/route.ts");

const { extraction, stores, classIdle, enqueueFile } = server;

const imports: string[] = [];
const original = extraction.importNotes;
extraction.importNotes = async (input) => {
	imports.push(input.text);
	return { nodes: 0, chains: 0 };
};

after(() => {
	extraction.importNotes = original;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe("PDF text off the server thread", () => {
	it("the worker returns exactly the in-process text", async () => {
		const inProcess = await pdfExtract(FIXTURE, "all");
		const offThread = await pdfTextOffThread(FIXTURE);
		assert.equal(offThread, inProcess);
	});

	it("the worker reports a broken PDF as an error", async () => {
		await assert.rejects(pdfTextOffThread(path.join(import.meta.dirname, "fixtures", "not-a-pdf.txt")));
	});

	it("the streamed fingerprint equals the whole-file hash", async () => {
		const whole = createHash("sha256").update(fs.readFileSync(FIXTURE)).digest("hex").slice(0, 16);
		assert.equal(await fingerprintFile(FIXTURE), whole);
	});
});

describe("saved PDF text", () => {
	it("is saved by fingerprint, reused unchanged, and removed with the file", async () => {
		const created = await classesRoute.POST(
			new Request("http://localhost/api/classes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "PHYS 2A" }) }),
		);
		const id = (await created.json()).class.id as string;
		const form = new FormData();
		form.append("kind", "study");
		form.append("files", new File([fs.readFileSync(FIXTURE)], "reading.pdf"));
		const up = await (await filesRoute.POST(new Request(`http://localhost/api/classes/${id}/files`, { method: "POST", body: form }), ctx({ id }))).json();
		const fileId = up.results[0].file.id as string;
		await classIdle(id);
		assert.match(imports.at(-1)!, /Calculus/);

		const fp = await fingerprintFile(FIXTURE);
		const saved = path.join(stores.classStore.filesDir(id), "texts", `${fileId}.${fp}.v2.txt`);
		assert.equal(fs.readFileSync(saved, "utf-8"), imports.at(-1));

		// Unfinished last time (a relaunch): the saved text is used, the PDF is not re-read.
		fs.writeFileSync(saved, "SAVED TEXT", "utf-8");
		const record = stores.classStore.getClass(id)!;
		stores.classStore.saveFiles(id, record.files.map((f) => (f.id === fileId ? { ...f, status: "pending" as const } : f)));
		enqueueFile(id, fileId);
		await classIdle(id);
		assert.equal(imports.at(-1), "SAVED TEXT");

		const removed = await fileRoute.DELETE(new Request(`http://localhost/api/classes/${id}/files/${fileId}`, { method: "DELETE" }), ctx({ id, fileId }));
		assert.equal(removed.status, 200);
		assert.equal(fs.existsSync(saved), false);
	});
});
