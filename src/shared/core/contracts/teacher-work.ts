/**
 * The teacher's round of work (GET /api/teacher-work), for Follow's slip: the reads and notes
 * it made since the learner's line reached it. Changes are not steps; the activity log has them.
 */
import { isRecord } from "../is-record.ts";

/** A file read's place, so a click opens it in the source pop-up: a passage id, or a place ("p. 1"). */
export type StepLink = { spaceId: string; fileId: string; name: string } & ({ passage: number } | { range: string });

/** One step, in the server's words ("Reading HW7_F26.pdf, page 1"). */
interface TeacherStep {
	id: string;
	/** ISO time. */
	at: string;
	text: string;
	link?: StepLink;
}

export interface TeacherWork {
	live: boolean;
	/** ISO time the round began; null with no round. */
	since: string | null;
	/** Oldest first. */
	steps: TeacherStep[];
}

const str = (v: unknown): v is string => typeof v === "string" && v !== "";

function readLink(raw: unknown): StepLink | undefined {
	if (!isRecord(raw) || !str(raw.spaceId) || !str(raw.fileId) || !str(raw.name)) return undefined;
	const file = { spaceId: raw.spaceId, fileId: raw.fileId, name: raw.name };
	if (typeof raw.passage === "number") return { ...file, passage: raw.passage };
	return str(raw.range) ? { ...file, range: raw.range } : undefined;
}

/** The answer made safe to use: no round when it is not one. */
export function readTeacherWork(raw: unknown): TeacherWork {
	if (!isRecord(raw) || raw.live !== true || !str(raw.since) || !Array.isArray(raw.steps)) return { live: false, since: null, steps: [] };
	const steps = raw.steps.flatMap((s): TeacherStep[] => {
		if (!isRecord(s) || !str(s.id) || !str(s.at) || !str(s.text)) return [];
		const link = readLink(s.link);
		return [{ id: s.id, at: s.at, text: s.text, ...(link ? { link } : {}) }];
	});
	return { live: true, since: raw.since, steps };
}
