/**
 * The teacher's round as one timeline: its steps and its changes, merged by time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAction } from "../../src/shared/core/events.ts";
import { readTeacherWork, type TeacherWork } from "../../src/shared/core/contracts/teacher-work.ts";
import { roundTimeline } from "../../src/frontend/components/teacher/timeline-model.ts";

const at = (s: number) => new Date(Date.parse("2026-11-22T20:00:00Z") + s * 1000).toISOString();
const change = (id: string, s: number, over: Partial<AgentAction> = {}): AgentAction => ({
	id,
	at: at(s),
	agent: "Claude Code",
	label: `Change ${id}`,
	spaceId: "spc_1",
	target: { kind: "deadline", id: "ddl_1" },
	page: "/space/deadlines",
	...over,
});
const round: TeacherWork = {
	live: true,
	since: at(10),
	steps: [
		{ id: "s1", at: at(11), text: "Looking at CSE 21" },
		{ id: "s2", at: at(13), text: "Reading HW7_F26.pdf, page 1", link: { spaceId: "spc_1", fileId: "f_1", name: "HW7_F26.pdf", range: "p. 1" } },
	],
};

describe("roundTimeline", () => {
	it("merges the round's steps with its changes, oldest first", () => {
		const rows = roundTimeline(round, [change("a2", 14), change("a1", 12)]);
		assert.deepEqual(
			rows.map((r) => [r.kind, r.text]),
			[
				["step", "Looking at CSE 21"],
				["change", "Change a1"],
				["step", "Reading HW7_F26.pdf, page 1"],
				["change", "Change a2"],
			],
		);
		const read = rows[2];
		assert.ok(read?.kind === "step" && read.link && "range" in read.link && read.link.range === "p. 1", "a file read keeps what a click opens");
		const added = rows[3];
		assert.ok(added?.kind === "change" && added.action.id === "a2", "a change keeps its entry");
		assert.equal(rows[0]?.kind === "step" && rows[0].link, null, "a plain step opens nothing");
	});

	it("leaves out changes before the round, the app's and the learner's own, and a background check's", () => {
		const recent = [change("before", 9), change("app", 12, { agent: "godspeed" }), change("you", 12, { agent: "you" }), change("check", 12, { background: true }), change("at-start", 10)];
		assert.deepEqual(
			roundTimeline(round, recent).map((r) => r.id),
			["at-start", "s1", "s2"],
		);
	});

	it("no round, no rows", () => {
		assert.deepEqual(roundTimeline(null, [change("a", 12)]), []);
		assert.deepEqual(roundTimeline({ live: false, since: null, steps: [] }, [change("a", 12)]), []);
	});
});

describe("readTeacherWork", () => {
	it("keeps a well-formed round and its links", () => {
		const raw = { live: true, since: at(0), steps: [{ id: "s", at: at(1), text: "Reading a.pdf", link: { spaceId: "spc", fileId: "f", name: "a.pdf", passage: 3 } }] };
		assert.deepEqual(readTeacherWork(raw), raw);
	});
	it("drops what is not a step, and a link it can't open", () => {
		const raw = { live: true, since: at(0), steps: [{ id: "s", at: at(1), text: "Reading a.pdf", link: { spaceId: "spc", fileId: "f" } }, { id: "", at: at(1), text: "x" }, null] };
		assert.deepEqual(readTeacherWork(raw), { live: true, since: at(0), steps: [{ id: "s", at: at(1), text: "Reading a.pdf" }] });
	});
	it("reads anything else as no round", () => {
		for (const raw of [null, {}, { live: false, since: null, steps: [] }, { live: true, since: null, steps: [] }, "x"]) {
			assert.deepEqual(readTeacherWork(raw), { live: false, since: null, steps: [] });
		}
	});
});
