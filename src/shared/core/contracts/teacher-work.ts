/**
 * The teacher's round of work (GET /api/teacher-work), for Follow's slip: the reads and notes
 * it made since a teacher panel chat's turn began. Changes are not steps; the activity log has
 * them.
 */
import { isRecord, isText } from "../is-record.ts";

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
	/** The teacher panel chat whose turn the round is; null with no round. */
	chatId: string | null;
	/** Oldest first. */
	steps: TeacherStep[];
}

function readLink(raw: unknown): StepLink | undefined {
	if (!isRecord(raw) || !isText(raw.spaceId) || !isText(raw.fileId) || !isText(raw.name)) return undefined;
	const file = { spaceId: raw.spaceId, fileId: raw.fileId, name: raw.name };
	if (typeof raw.passage === "number") return { ...file, passage: raw.passage };
	return isText(raw.range) ? { ...file, range: raw.range } : undefined;
}

/** The answer made safe to use: no round when it is not one. */
export function readTeacherWork(raw: unknown): TeacherWork {
	if (!isRecord(raw) || raw.live !== true || !isText(raw.since) || !isText(raw.chatId) || !Array.isArray(raw.steps)) return { live: false, since: null, chatId: null, steps: [] };
	const steps = raw.steps.flatMap((s): TeacherStep[] => {
		if (!isRecord(s) || !isText(s.id) || !isText(s.at) || !isText(s.text)) return [];
		const link = readLink(s.link);
		return [{ id: s.id, at: s.at, text: s.text, ...(link ? { link } : {}) }];
	});
	return { live: true, since: raw.since, chatId: raw.chatId, steps };
}
