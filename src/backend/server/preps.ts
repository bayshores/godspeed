/**
 * PREPS — the one writer of a space's prep sheet and the request behind
 * it.
 *
 * A prep is a space with a `prep` on its record. Making one saves the
 * learner's words (and any files they attached, as space info) and asks
 * the teacher for the sheet: one background work item on the single-submit
 * seam (agent/subagents/prep-writer.ts), so it stays out of Talk and the
 * lessons. One request at a time per prep. The learner (on its page) and
 * the teacher (in Talk) can change the sheet, and the learner can ask for
 * it again. Each change goes out as "prep-changed"; the page fetches the
 * view again.
 */
import { randomUUID } from "node:crypto";
import type { SpacePrep, SpaceRecord } from "../../shared/core/contracts.ts";
import { emit } from "../../shared/core/events.ts";
import { mockAnswers, mockSummary } from "../../shared/core/mock.ts";
import { newPrep, prepRequestText, prepTopicProgress, withEdits, withSheet, type PrepEdits, type PrepView } from "../../shared/core/prep.ts";
import { localDay } from "../../shared/core/today-note.ts";
import { agentEngine } from "../agent/models.ts";
import { writePrepSheet } from "../agent/subagents/prep-writer.ts";
import { spaceFilePath } from "./space-card.ts";
import { addCopiedFile, copiedFileProblem } from "./spaces.ts";
import { currentMocks } from "./mock-end.ts";
import { isRunning, mockRunKey, prepSeams, runError, startRun } from "./prep-runs.ts";
import { spaceAnswers } from "./progress.ts";
import { stores } from "./stores.ts";

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
export const done: Outcome<null> = { ok: true, value: null };

const changed = (spaceId: string) => emit("prep-changed", { spaceId });

const newTopicId = () => `pt_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** A space that is a prep, or the 404 for one that isn't. */
export function prepOf(spaceId: string): Outcome<SpaceRecord & { prep: SpacePrep }> {
	const record = stores.spaceStore.getSpace(spaceId);
	return record?.prep ? { ok: true, value: record as SpaceRecord & { prep: SpacePrep } } : fail(404, "No such prep");
}

/**
 * Make a prep from the learner's words and ask the teacher for its sheet.
 * Attached files become its space info; one godspeed can't read refuses
 * the whole request, before anything is made.
 */
export function createPrep(input: { goal: string; date?: string; files?: ReadonlyArray<{ name: string; bytes: Uint8Array }> }): Outcome<{ spaceId: string }> {
	const prep = newPrep(input.goal, input.date);
	if (!prep) return fail(400, "Say what you are preparing for.");
	const files = input.files ?? [];
	for (const file of files) {
		const problem = copiedFileProblem(file.name, file.bytes);
		if (problem) return fail(400, problem);
	}
	const record = stores.spaceStore.createSpace({ name: prep.goal, prep });
	for (const file of files) addCopiedFile(record.id, file.name, file.bytes, "info");
	startWrite(record.id);
	return { ok: true, value: { spaceId: record.id } };
}

export function prepView(spaceId: string): Outcome<PrepView> {
	const found = prepOf(spaceId);
	if (!found.ok) return found;
	const record = found.value;
	const error = runError(spaceId);
	const mocks = currentMocks(spaceId);
	return {
		ok: true,
		value: {
			spaceId,
			name: record.name,
			prep: record.prep,
			topics: prepTopicProgress(record.prep.topics, [...spaceAnswers(spaceId), ...mocks.flatMap(mockAnswers)]),
			mocks: mocks.map((m) => mockSummary(m, isRunning(mockRunKey(spaceId, m.id)), runError(mockRunKey(spaceId, m.id)))),
			writing: isRunning(spaceId),
			...(error ? { error } : {}),
		},
	};
}

/** Ask the teacher to write the sheet (again). Refused while it is being written. */
export function startWrite(spaceId: string): Outcome<null> {
	const found = prepOf(spaceId);
	if (!found.ok) return found;
	if (isRunning(spaceId)) return fail(409, "Your agent is still writing this sheet.");
	const record = found.value;
	const prompt = prepRequestText({
		goal: record.prep.goal,
		...(record.prep.date ? { date: record.prep.date } : {}),
		today: localDay(),
		files: record.files.flatMap((f) => {
			const path = spaceFilePath(record, f);
			return path ? [{ name: f.name, path }] : [];
		}),
		topics: record.prep.topics,
	});
	startRun(spaceId, spaceId, async (signal) => {
		const sheet = await writePrepSheet({ goal: record.prep.goal, prompt, engine: prepSeams.engine ?? agentEngine(), signal });
		// The learner may have changed the day or deleted the prep meanwhile.
		const now = prepView(spaceId);
		if (!now.ok) return;
		const answered = new Set(now.value.topics.filter((t) => t.answered > 0).map((t) => t.id));
		const next = withSheet(now.value.prep, sheet, new Date().toISOString(), newTopicId, answered);
		stores.spaceStore.updateSpace(spaceId, { prep: next.prep, name: next.name });
	});
	return done;
}

/** Change the sheet: the learner on its page, or the teacher in Talk. */
export function changePrep(spaceId: string, edits: PrepEdits): Outcome<null> {
	const found = prepOf(spaceId);
	if (!found.ok) return found;
	if (isRunning(spaceId)) return fail(409, "Your agent is still writing this sheet. Change it once it is done.");
	const next = withEdits(found.value.prep, edits, newTopicId);
	if (typeof next === "string") return fail(400, next);
	stores.spaceStore.updateSpace(spaceId, { prep: next });
	changed(spaceId);
	return done;
}
