/**
 * Deadlines godspeed asks the agent about by itself: which ones, once each,
 * and how the request reads to the model and shows in Talk.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askedDeadlineIds, coverageRequest, talkQuiet, unlinkedDeadlines } from "../../src/shared/core/deadline-requests.ts";
import { toLlmMessages } from "../../src/shared/core/native-messages.ts";
import { projectView } from "../../src/shared/core/view.ts";

const file = (kind: "study" | "info", status: "ready" | "pending") => ({ id: `f_${kind}_${status}`, name: "x.pdf", kind, status }) as never;
const deadline = (id: string, over: Partial<{ date: string; time: string; fileIds: string[]; done: boolean }> = {}) => ({
	id,
	kind: "exam" as const,
	name: `Exam ${id}`,
	date: "2026-11-04",
	fileIds: [],
	done: false,
	...over,
});
const space = (id: string, over: Partial<{ archived: boolean; files: never[]; deadlines: ReturnType<typeof deadline>[] }> = {}) => ({
	id,
	name: id.toUpperCase(),
	archived: false,
	files: [file("study", "ready")],
	deadlines: [] as ReturnType<typeof deadline>[],
	...over,
});

describe("deadlines godspeed asks about", () => {
	it("open, unlinked deadlines in spaces with a readable study file, each once", () => {
		const spaces = [
			space("a", {
				deadlines: [
					deadline("open", { time: "18:30" }),
					deadline("linked", { fileIds: ["f1"] }),
					deadline("done", { done: true }),
					deadline("past", { date: "2026-10-01" }),
					deadline("asked"),
				],
			}),
			space("b", { archived: true, deadlines: [deadline("archived")] }),
			space("c", { files: [file("info", "ready"), file("study", "pending")], deadlines: [deadline("unread")] }),
		];
		const found = unlinkedDeadlines(spaces, "2026-11-02", new Set(["asked"]));
		assert.deepEqual(found, [{ id: "open", name: "Exam open", spaceName: "A", spaceId: "a", date: "2026-11-04", time: "18:30" }]);
	});

	it("the request names each deadline for the model, and Talk shows it as from godspeed", () => {
		const request = coverageRequest(unlinkedDeadlines([space("a", { deadlines: [deadline("d1")] })], "2026-11-02", new Set()));
		assert.equal(request.customType, "app-request");
		const [llm] = toLlmMessages([request] as never);
		const text = (llm as { content: { text: string }[] }).content[0]!.text;
		assert.match(text, /^\[From godspeed, not the learner\] This deadline has no files linked yet:/);
		assert.match(text, /Exam d1 in A \(space_id a, deadline_id d1, due 2026-11-04\)/);
		assert.match(text, /update_space_deadline/);
		const [view] = projectView([request]);
		assert.deepEqual(view!.parts, [{ type: "data-app-request", id: `ar_${request.id}`, data: { deadlines: [{ id: "d1", name: "Exam d1", spaceName: "A" }] } }]);
		assert.deepEqual([...askedDeadlineIds([request])], ["d1"]);
	});
});

describe("talkQuiet", () => {
	const now = Date.parse("2026-11-06T16:40:00.000Z");
	const talk = (minutesAgo: number, messages: unknown[] = [{}]) => ({ updatedAt: new Date(now - minutesAgo * 60_000).toISOString(), messages });
	it("holds godspeed's request while the learner is talking", () => {
		assert.equal(talkQuiet(talk(2), now), false);
		assert.equal(talkQuiet(talk(9.9), now), false);
	});
	it("sends it once Talk has had no new message for 10 minutes, or has none", () => {
		assert.equal(talkQuiet(talk(10), now), true);
		assert.equal(talkQuiet(talk(1, []), now), true);
		assert.equal(talkQuiet(undefined, now), true);
	});
});
