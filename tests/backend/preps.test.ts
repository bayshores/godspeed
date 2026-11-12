/**
 * PREPS end to end against a scripted agent: making one saves the
 * learner's words and attached files and asks for the sheet, the sheet
 * lands on the space with a short name, a bad sheet is sent back, a failed
 * write can be tried again, the learner's own changes, and the routes.
 * Isolated LH_DATA_DIR (set before any config-loading import).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type ToolCall } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-preps-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { spaceStore } = await import("../../src/backend/store/spaces.ts");
const { subscribe } = await import("../../src/shared/core/events.ts");
const preps = await import("../../src/backend/server/preps.ts");
const { prepSeams } = await import("../../src/backend/server/prep-runs.ts");
const createRoute = await import("../../src/app/api/preps/route.ts");
const prepRoute = await import("../../src/app/api/spaces/[id]/prep/route.ts");
import type { PrepView } from "../../src/shared/core/prep.ts";

after(() => {
	prepSeams.engine = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const SHEET = {
	name: "Acme junior web test",
	about: "Four coding questions in 70 minutes.",
	sources: [{ title: "Acme test guide", url: "https://example.com/guide" }],
	topics: [{ name: "Arrays and strings", why: "Questions 1 and 2" }, { name: "Hash maps" }],
	mock: { questions: 4, minutes: 70 },
};

/** A faux agent that sends each step's sheet (a string: it only talks);
 *  records each request's prompt and what godspeed answered its calls. */
function agent(...steps: Array<Record<string, unknown> | string>) {
	const faux = createFauxCore({});
	const prompts: string[] = [];
	const replies: string[] = [];
	faux.setResponses(
		steps.map((step) => (ctx: { messages: Array<{ role: string; content: unknown }> }) => {
			const first = ctx.messages.find((m) => m.role === "user");
			prompts.push(typeof first?.content === "string" ? first.content : JSON.stringify(first?.content));
			const last = ctx.messages[ctx.messages.length - 1];
			if (last?.role === "toolResult") replies.push(JSON.stringify(last.content));
			if (typeof step === "string") return fauxAssistantMessage([fauxText(step)], { stopReason: "stop" });
			return fauxAssistantMessage([fauxToolCall("write_prep_sheet", step as ToolCall["arguments"])], { stopReason: "toolUse" });
		}),
	);
	prepSeams.engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	return { prompts, replies };
}

const view = (spaceId: string): PrepView => {
	const v = preps.prepView(spaceId);
	assert.ok(v.ok);
	return v.value;
};

/** Resolves once the prep's request has ended. */
async function settled(spaceId: string): Promise<void> {
	for (let i = 0; i < 400 && view(spaceId).writing; i++) await new Promise((r) => setTimeout(r, 5));
	assert.equal(view(spaceId).writing, false, "the request ended");
}

const post = (spaceId: string, body: unknown) =>
	prepRoute.POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: spaceId }) });

describe("a prep", () => {
	it("is made from the learner's words, and the teacher's sheet lands on it", async () => {
		const { prompts } = agent(SHEET);
		const events: string[] = [];
		const stop = subscribe((e) => {
			if (e.type === "prep-changed") events.push(e.spaceId);
		});
		const posting = { name: "posting.txt", bytes: Buffer.from("Junior web role, React.") };
		const before = spaceStore.listSpaces().length;
		const refused = preps.createPrep({ goal: "Acme", files: [posting, { name: "photo.heic", bytes: new Uint8Array([0, 1, 2]) }] });
		assert.ok(!refused.ok && /photo\.heic: unsupported file type/.test(refused.error));
		assert.equal(spaceStore.listSpaces().length, before, "nothing is made when a file can't be read");
		const made = preps.createPrep({ goal: " Acme online test for a junior web role ", date: "2026-11-20", files: [posting] });
		assert.ok(made.ok);
		const { spaceId } = made.value;
		assert.equal(view(spaceId).writing, true);
		assert.equal(view(spaceId).name, "Acme online test for a junior web role", "named by the learner's words until the sheet is in");
		await settled(spaceId);
		stop();
		const v = view(spaceId);
		assert.equal(v.name, "Acme junior web test");
		assert.equal(v.prep.about, SHEET.about);
		assert.deepEqual(v.prep.mock, SHEET.mock);
		assert.equal(v.prep.date, "2026-11-20");
		assert.deepEqual(v.topics.map((t) => [t.name, t.status]), [["Arrays and strings", "untested"], ["Hash maps", "untested"]]);
		assert.match(v.topics[0]!.id, /^pt_[a-f0-9]{8}$/);
		assert.ok(events.length >= 2 && events.every((id) => id === spaceId), "announced when it started and when it ended");
		assert.match(prompts[0]!, /They are preparing for: Acme online test for a junior web role/);
		assert.match(prompts[0]!, /It is on 2026-11-20\./);
		assert.match(prompts[0]!, /posting\.txt: .*posting\.txt/, "the attached file, with where to read it");
		const record = spaceStore.getSpace(spaceId)!;
		assert.deepEqual(record.files.map((f) => [f.name, f.kind]), [["posting.txt", "info"]]);
	});

	it("names a prep with a long goal by its first words, and keeps the whole goal", async () => {
		agent(SHEET);
		const goal = "Second round with the platform team at Acme, two hours of system design and one of code";
		const made = preps.createPrep({ goal });
		assert.ok(made.ok);
		const before = view(made.value.spaceId);
		assert.equal(before.name, "Second round with the platform team at…");
		assert.equal(before.prep.goal, goal);
		await settled(made.value.spaceId);
	});

	it("sends a sheet that can't be kept back, and keeps the next one", async () => {
		const { replies } = agent({ ...SHEET, about: "  " }, SHEET);
		const made = preps.createPrep({ goal: "Bank interview" });
		assert.ok(made.ok);
		await settled(made.value.spaceId);
		assert.match(replies[0]!, /about is empty/);
		assert.equal(view(made.value.spaceId).prep.about, SHEET.about);
	});

	it("says why a write failed, and writes again when asked, keeping topic ids", async () => {
		agent("I could not find anything.", "Still nothing.", "No.", "No.", "No.");
		const made = preps.createPrep({ goal: "Driving theory test" });
		assert.ok(made.ok);
		const spaceId = made.value.spaceId;
		await settled(spaceId);
		assert.match(view(spaceId).error ?? "", /never sent the sheet/);
		assert.equal(view(spaceId).prep.topics.length, 0);

		agent(SHEET);
		assert.ok(preps.startWrite(spaceId).ok);
		assert.equal(preps.startWrite(spaceId).ok, false, "one request at a time");
		await settled(spaceId);
		assert.equal(view(spaceId).error, undefined);
		const first = view(spaceId).topics.map((t) => t.id);

		const { prompts } = agent({ ...SHEET, topics: [{ name: "Recursion" }, { name: "hash maps" }] });
		assert.equal((await post(spaceId, { action: "write" })).status, 200);
		await settled(spaceId);
		assert.match(prompts[0]!, /The sheet's topics now[^]*- Arrays and strings\n- Hash maps/);
		assert.deepEqual(view(spaceId).topics.map((t) => t.name), ["Recursion", "hash maps"]);
		assert.equal(view(spaceId).topics[1]!.id, first[1], "the same topic keeps its id");
	});

	it("takes the learner's own changes through its route", async () => {
		agent(SHEET);
		const res = await createRoute.POST(new Request("http://x/api/preps", { method: "POST", body: (() => { const f = new FormData(); f.set("goal", "Initech phone screen"); return f; })() }));
		assert.equal(res.status, 201);
		const { spaceId } = (await res.json()) as { spaceId: string };
		assert.equal((await post(spaceId, { action: "add-topic", name: "Graphs" })).status, 409, "not while the sheet is being written");
		await settled(spaceId);

		assert.equal((await post(spaceId, { action: "add-topic", name: "Graphs" })).status, 200);
		assert.equal((await post(spaceId, { action: "add-topic", name: "graphs" })).status, 400);
		const graphs = view(spaceId).topics.at(-1)!;
		assert.equal(graphs.name, "Graphs");
		assert.equal((await post(spaceId, { action: "remove-topic", topicId: graphs.id })).status, 200);
		assert.deepEqual(view(spaceId).topics.map((t) => t.name), ["Arrays and strings", "Hash maps"]);
		assert.equal((await post(spaceId, { action: "date", date: "2026-12-01" })).status, 200);
		assert.equal(view(spaceId).prep.date, "2026-12-01");
		assert.equal((await post(spaceId, { action: "date", date: "soon" })).status, 400);
		assert.equal((await post(spaceId, { action: "date", date: null })).status, 200);
		assert.equal(view(spaceId).prep.date, undefined);
		assert.equal((await post(spaceId, { action: "nope" })).status, 400);

		const got = await prepRoute.GET(new Request("http://x/api"), { params: Promise.resolve({ id: spaceId }) });
		assert.equal(((await got.json()) as PrepView).name, "Acme junior web test");
	});

	it("refuses an empty goal and spaces that are not preps", async () => {
		assert.equal(preps.createPrep({ goal: "   " }).ok, false);
		const plain = spaceStore.createSpace({ name: "Plain space" });
		assert.equal(preps.prepView(plain.id).ok, false);
		assert.equal((await post(plain.id, { action: "write" })).status, 404);
		assert.equal((await prepRoute.GET(new Request("http://x/api"), { params: Promise.resolve({ id: "nope" }) })).status, 404);
	});
});
