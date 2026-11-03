/**
 * The Talk thread as rows: the learner's messages (text and files),
 * godspeed's own requests, the teacher's replies, and one row per change
 * a tool made (from its result's details).
 */
import { isAttachmentPart, type AgentAction, type AppRequestDeadline, type ClassChange, type LhViewMessage, type LhViewPart } from "@/core";

type TalkRow =
	| { kind: "you"; id: string; text: string; files: LhViewPart[] }
	| { kind: "teacher"; id: string; text: string }
	| { kind: "app"; id: string; deadlines: AppRequestDeadline[] }
	| { kind: "change"; id: string; change: ClassChange };

function changesOf(output: unknown): ClassChange[] {
	const changes = (output as { changes?: unknown } | null)?.changes;
	return Array.isArray(changes) ? changes.filter((c): c is ClassChange => typeof c?.label === "string" && typeof c?.page === "string") : [];
}

export function talkRows(messages: readonly LhViewMessage[]): TalkRow[] {
	const rows: TalkRow[] = [];
	for (const m of messages) {
		if (m.role === "user") {
			const text = m.parts.filter((p) => p.type === "text" && p.text?.trim()).map((p) => p.text).join("\n");
			const files = m.parts.filter(isAttachmentPart);
			if (text || files.length > 0) rows.push({ kind: "you", id: m.id, text, files });
		}
		m.parts.forEach((part, i) => {
			const id = `${m.id}-${i}`;
			if (part.type === "text" && part.text?.trim()) {
				if (m.role !== "user") rows.push({ kind: "teacher", id, text: part.text });
			} else if (part.type === "data-app-request")
				rows.push({ kind: "app", id, deadlines: (part.data as { deadlines: AppRequestDeadline[] }).deadlines });
			else if (m.role === "assistant" && part.type.startsWith("tool-"))
				changesOf(part.output).forEach((change, n) => rows.push({ kind: "change", id: `${id}-${n}`, change }));
		});
	}
	return rows;
}

/** Who a row is from (a change row belongs to the teacher). */
export function speakerOf(row: TalkRow): "you" | "app" | "teacher" {
	return row.kind === "you" || row.kind === "app" ? row.kind : "teacher";
}

/** Whether a row starts a new speaker's turn, so the script shows the name
 *  in the margin once per turn. */
export function startsTurn(rows: readonly TalkRow[], index: number): boolean {
	const prev = rows[index - 1];
	return !prev || speakerOf(rows[index]!) !== speakerOf(prev);
}

/** "Asked Marco to work out what's on Midterm (CSE 21) from your files." */
export function appRequestText(teacher: string, deadlines: readonly AppRequestDeadline[]): string {
	const names = deadlines.map((d) => `${d.name} (${d.className})`);
	const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
	return `Asked ${teacher} to work out what's on ${list} from your files.`;
}

/** The recorded action behind a change row (newest first), so a click can
 *  go there like the Activity rows do. Null once it left the recent list. */
export function actionFor(change: ClassChange, recent: readonly AgentAction[]): AgentAction | null {
	return recent.find((a) => a.label === change.label && a.page === change.page) ?? null;
}

/** A message asked from elsewhere while the teacher replies waits after the
 *  learner's unsent text, a blank line between. */
export function draftWithAsk(draft: string, ask: string): string {
	return draft.trim() ? `${draft.trimEnd()}\n\n${ask}` : ask;
}
