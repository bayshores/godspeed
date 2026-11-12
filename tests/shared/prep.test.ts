/**
 * The prep sheet's rules: what a saved one keeps, how the teacher's sheet
 * is taken (topics keep their ids by name), the learner's own changes, and
 * each topic's track record from the answers tagged with it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newPrep, parsePrep, prepStudyTopics, prepTopicProgress, sheetProblem, weakestFirst, withEdits, withSheet, type PrepEdits, type WrittenSheet } from "../../src/shared/core/prep.ts";
import type { SpacePrep } from "../../src/shared/core/contracts.ts";

const ids = () => {
	let n = 0;
	return () => `pt_${(++n).toString().padStart(8, "0")}`;
};

const SHEET: WrittenSheet = {
	name: "Acme junior web test",
	about: "Four coding questions in 70 minutes.",
	sources: [
		{ title: "Acme test guide", url: "https://example.com/guide" },
		{ title: "", url: "https://example.com/guide" },
		{ title: "Not a link", url: "javascript:alert(1)" },
	],
	topics: [{ name: "Arrays and strings", why: "Questions 1 and 2" }, { name: " arrays and strings " }, { name: "Hash maps" }, { name: "  " }],
	mock: { questions: 4, minutes: 70 },
};

describe("a prep", () => {
	it("starts from the learner's words, with a day only when it is a real one", () => {
		assert.deepEqual(newPrep("  Acme online test\nfor a junior web role ", "2026-11-20"), {
			goal: "Acme online test for a junior web role",
			date: "2026-11-20",
			about: "",
			sources: [],
			topics: [],
		});
		assert.equal("date" in newPrep("Interview", "soon")!, false);
		assert.equal(newPrep("   "), null);
	});

	it("takes the teacher's sheet: clean sources, each topic once, a short name", () => {
		const { prep, name } = withSheet(newPrep("Acme online test", "2026-11-20")!, SHEET, "2026-11-11T10:00:00.000Z", ids(), new Set());
		assert.equal(name, "Acme junior web test");
		assert.deepEqual(prep.sources, [{ title: "Acme test guide", url: "https://example.com/guide" }]);
		assert.deepEqual(prep.topics, [
			{ id: "pt_00000001", name: "Arrays and strings", why: "Questions 1 and 2" },
			{ id: "pt_00000002", name: "Hash maps" },
		]);
		assert.deepEqual(prep.mock, { questions: 4, minutes: 70 });
		assert.equal(prep.date, "2026-11-20", "the learner's day stays");
		assert.equal(prep.writtenAt, "2026-11-11T10:00:00.000Z");
	});

	it("a topic keeps its id when the sheet is written again under the same name", () => {
		const newId = ids();
		const first = withSheet(newPrep("Acme online test")!, SHEET, "t1", newId, new Set()).prep;
		const again = withSheet(first, { ...SHEET, topics: [{ name: "Recursion" }, { name: "hash maps" }] }, "t2", newId, new Set()).prep;
		assert.deepEqual(again.topics.map((t) => [t.id, t.name]), [
			["pt_00000003", "Recursion"],
			["pt_00000002", "hash maps"],
		]);
	});

	it("a topic with answers stays when the sheet is written again without it", () => {
		const newId = ids();
		const first = withSheet(newPrep("Acme online test")!, SHEET, "t1", newId, new Set()).prep;
		const renamed = { ...SHEET, topics: [{ name: "Arrays & strings" }, { name: "Hash maps" }] };
		const again = withSheet(first, renamed, "t2", newId, new Set(["pt_00000001"])).prep;
		assert.deepEqual(again.topics.map((t) => [t.id, t.name]), [
			["pt_00000003", "Arrays & strings"],
			["pt_00000002", "Hash maps"],
			["pt_00000001", "Arrays and strings"],
		]);
		const full = { ...SHEET, topics: Array.from({ length: 12 }, (_, i) => ({ name: `Topic ${i + 1}` })) };
		const capped = withSheet(first, full, "t3", newId, new Set(["pt_00000001"])).prep;
		assert.equal(capped.topics.length, 12, "the kept one takes the last place");
		assert.equal(capped.topics.at(-1)!.id, "pt_00000001");
	});

	it("says why a sheet can't be kept", () => {
		assert.equal(sheetProblem(SHEET), null);
		assert.match(sheetProblem({ ...SHEET, name: " " })!, /name/);
		assert.match(sheetProblem({ ...SHEET, about: "" })!, /about/);
		assert.match(sheetProblem({ ...SHEET, topics: [{ name: "" }] })!, /topics/);
		assert.match(sheetProblem({ ...SHEET, mock: { questions: 0, minutes: 70 } })!, /mock/);
		assert.match(sheetProblem({ ...SHEET, mock: { questions: 4, minutes: 1000 } })!, /mock/);
	});

	it("takes edits to the sheet, or says why not", () => {
		const newId = ids();
		const prep = withSheet(newPrep("Acme online test")!, SHEET, "t1", newId, new Set()).prep;
		const edit = (from: SpacePrep, edits: PrepEdits) => {
			const next = withEdits(from, edits, newId);
			assert.ok(typeof next !== "string", String(next));
			return next;
		};
		const more = edit(prep, { addTopics: [{ name: " Sorting ", why: "Question 3" }] });
		assert.deepEqual(more.topics.at(-1), { id: "pt_00000003", name: "Sorting", why: "Question 3" });
		assert.equal(withEdits(more, { addTopics: [{ name: "sorting" }] }, newId), '"sorting" is already on the sheet.');
		assert.equal(withEdits(more, { addTopics: [{ name: "  " }] }, newId), "A topic's name is empty.");
		assert.deepEqual(edit(more, { removeTopicIds: ["pt_00000001"] }).topics.map((t) => t.name), ["Hash maps", "Sorting"]);
		assert.equal(withEdits(more, { removeTopicIds: ["pt_nope"] }, newId), 'No topic "pt_nope" on the sheet.');
		const full = edit(prep, { addTopics: Array.from({ length: 10 }, (_, i) => ({ name: `Topic ${i}` })) });
		assert.match(withEdits(full, { addTopics: [{ name: "One more" }] }, newId) as string, /The sheet is full \(12 topics\)/);

		const dated = edit(prep, { date: "2026-12-01" });
		assert.equal(dated.date, "2026-12-01");
		assert.equal("date" in edit(dated, { date: null }), false);
		assert.equal(edit(dated, { about: " Three rounds. " }).date, "2026-12-01", "what isn't given stays");
		assert.equal(withEdits(prep, { date: "soon" }, newId), "date must be YYYY-MM-DD.");
		assert.equal(edit(prep, { about: " Three rounds. " }).about, "Three rounds.");
		assert.match(withEdits(prep, { about: " " }, newId) as string, /about is empty/);
		assert.deepEqual(edit(prep, { mock: { questions: 3, minutes: 60 } }).mock, { questions: 3, minutes: 60 });
		assert.match(withEdits(prep, { mock: { questions: 0, minutes: 60 } }, newId) as string, /mock must be/);
		assert.deepEqual(edit(prep, {}), prep);
	});

	it("reads a saved prep back the same, and drops what isn't one", () => {
		const prep = withSheet(newPrep("Acme online test", "2026-11-20")!, SHEET, "2026-11-11T10:00:00.000Z", ids(), new Set()).prep;
		assert.deepEqual(parsePrep(JSON.parse(JSON.stringify(prep))), prep);
		assert.equal(parsePrep(undefined), null);
		assert.equal(parsePrep({ goal: "" }), null);
		const odd = parsePrep({ goal: "Interview", topics: [{ id: "x", name: "Bad id" }, { id: "pt_1", name: "Kept" }, { id: "pt_1", name: "Twice" }], mock: { questions: 99, minutes: 1 } })!;
		assert.deepEqual(odd.topics, [{ id: "pt_1", name: "Kept" }]);
		assert.equal("mock" in odd, false);
	});
});

describe("prep topics", () => {
	const topics = [
		{ id: "pt_a", name: "Arrays" },
		{ id: "pt_b", name: "Hash maps" },
		{ id: "pt_c", name: "Recursion" },
		{ id: "pt_d", name: "Sorting" },
	];
	const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T10:00:00.000Z`;
	const answers = [
		...Array.from({ length: 9 }, (_, i) => ({ nodeId: "pt_a", outcome: "right" as const, answeredAt: at(i + 1) })),
		{ nodeId: "pt_a", outcome: "wrong" as const, answeredAt: at(10) },
		{ nodeId: "pt_b", outcome: "right" as const, answeredAt: at(1) },
		{ nodeId: "pt_b", outcome: "right" as const, answeredAt: at(2) },
		{ nodeId: "pt_b", outcome: "dontKnow" as const, answeredAt: at(3) },
		{ nodeId: "pt_d", outcome: "wrong" as const, answeredAt: at(1) },
		{ outcome: "right" as const, answeredAt: at(1) },
	];

	it("count only the answers tagged with them", () => {
		const progress = prepTopicProgress(topics, answers);
		assert.deepEqual(progress.map((t) => [t.name, t.status, t.right, t.answered]), [
			["Arrays", "strong", 9, 10],
			["Hash maps", "shaky", 2, 3],
			["Recursion", "untested", 0, 0],
			["Sorting", "weak", 0, 1],
		]);
		assert.equal(progress[2]!.rate, null);
		assert.deepEqual(progress.map((t) => t.latestWrong ?? false), [false, false, false, true], "only a weak topic is flagged");
	});

	it("flag a weak topic only while its newest answer, by time, is not right", () => {
		const weak = [
			{ nodeId: "pt_c", outcome: "right" as const, answeredAt: at(5) },
			{ nodeId: "pt_c", outcome: "wrong" as const, answeredAt: at(3) },
			{ nodeId: "pt_c", outcome: "wrong" as const, answeredAt: at(4) },
		];
		assert.equal(prepTopicProgress(topics, weak)[2]!.latestWrong, undefined, "caught up, though the mock's answers came later in the list");
		assert.equal(prepTopicProgress(topics, [...weak, { nodeId: "pt_c", outcome: "dontKnow" as const, answeredAt: at(6) }])[2]!.latestWrong, true);
	});

	it("give a study session the weakest ones with where the learner stands, or the ones named", () => {
		const progress = prepTopicProgress(topics, answers);
		assert.deepEqual(prepStudyTopics(progress, []), [
			{ id: "pt_d", name: "Sorting", status: "weak", latestWrong: true, factIds: [] },
			{ id: "pt_b", name: "Hash maps", status: "shaky", factIds: [] },
			{ id: "pt_c", name: "Recursion", status: "untested", factIds: [] },
		]);
		assert.deepEqual(prepStudyTopics(progress, ["pt_a"]), [{ id: "pt_a", name: "Arrays", status: "strong", factIds: [] }]);
	});

	it("are studied weakest first: going badly, then not started, then solid", () => {
		assert.deepEqual(weakestFirst(prepTopicProgress(topics, answers)).map((t) => t.name), ["Sorting", "Hash maps", "Recursion", "Arrays"]);
		assert.deepEqual(weakestFirst(prepTopicProgress(topics, [])).map((t) => t.name), ["Arrays", "Hash maps", "Recursion", "Sorting"], "ties keep the sheet's order");
	});
});
