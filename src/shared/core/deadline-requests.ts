/**
 * Deadlines godspeed asks the agent about by itself, so the learner never
 * has to: open ones with nothing linked, in a space with files it can read.
 * Each deadline is asked about once (the Talk record remembers).
 */
import type { SpaceRecord } from "./contracts/space.ts";
import { newAppRequestMessage, type AppRequestDeadline, type LhMarkerMessage, type LhMessage } from "./native-messages.ts";

interface UnlinkedDeadline extends AppRequestDeadline {
	spaceId: string;
	date: string;
	time?: string;
}

type SpaceLike = Pick<SpaceRecord, "id" | "name" | "archived" | "files" | "deadlines">;

/** Open deadlines (not done, not past) with no files linked, in spaces that
 *  aren't archived and have a study file ready, minus the ones already asked. */
export function unlinkedDeadlines(spaces: readonly SpaceLike[], today: string, asked: ReadonlySet<string>): UnlinkedDeadline[] {
	return spaces.flatMap((c) =>
		c.archived || !c.files.some((f) => f.kind === "study" && f.status === "ready")
			? []
			: (c.deadlines ?? [])
					.filter((d) => !d.done && d.date >= today && d.fileIds.length === 0 && !asked.has(d.id))
					.map((d) => ({ id: d.id, name: d.name, spaceName: c.name, spaceId: c.id, date: d.date, ...(d.time ? { time: d.time } : {}) })),
	);
}

/** How long Talk has to sit without a new message before godspeed asks in it. */
const TALK_QUIET_MS = 10 * 60_000;

/** Talk has had no new message for TALK_QUIET_MS (or has none yet), so a
 *  request from godspeed won't cut into the learner's conversation. */
export function talkQuiet(talk: { updatedAt: string; messages: readonly unknown[] } | null | undefined, now: number): boolean {
	return !talk || talk.messages.length === 0 || now - Date.parse(talk.updatedAt) >= TALK_QUIET_MS;
}

/** The deadlines godspeed already asked about in this chat. */
export function askedDeadlineIds(messages: readonly LhMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if (m.role !== "custom" || m.customType !== "app-request") continue;
		for (const d of (m.details as { deadlines: AppRequestDeadline[] }).deadlines) ids.add(d.id);
	}
	return ids;
}

/** The request for the agent: work out what each deadline covers from the space's files. */
export function coverageRequest(deadlines: readonly UnlinkedDeadline[]): LhMarkerMessage {
	const list = deadlines
		.map((d) => `- ${d.name} in ${d.spaceName} (space_id ${d.spaceId}, deadline_id ${d.id}, due ${d.date}${d.time ? ` ${d.time}` : ""})`)
		.join("\n");
	const text =
		`${deadlines.length === 1 ? "This deadline has" : "These deadlines have"} no files linked yet:\n${list}\n\n` +
		"Work out what each one covers from the space's own files (a practice exam or review sheet, the syllabus schedule, announcements) " +
		"and link them with update_space_deadline: file_ids, left_out_ids for earlier files it doesn't cover, and source for the file you went by. " +
		"When the files don't settle it, say so in one line and ask the learner. Keep the reply short.";
	return newAppRequestMessage(
		text,
		deadlines.map((d) => ({ id: d.id, name: d.name, spaceName: d.spaceName })),
	);
}
