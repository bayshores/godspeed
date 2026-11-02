/**
 * The Talk thread as rows: the learner's messages, the teacher's replies,
 * and one row per change a tool made (from its result's details).
 */
import type { AgentAction, ClassChange, LhViewMessage } from "@/core";

type TalkRow =
	| { kind: "you"; id: string; text: string }
	| { kind: "teacher"; id: string; text: string }
	| { kind: "change"; id: string; change: ClassChange };

function changesOf(output: unknown): ClassChange[] {
	const changes = (output as { changes?: unknown } | null)?.changes;
	return Array.isArray(changes) ? changes.filter((c): c is ClassChange => typeof c?.label === "string" && typeof c?.page === "string") : [];
}

export function talkRows(messages: readonly LhViewMessage[]): TalkRow[] {
	const rows: TalkRow[] = [];
	for (const m of messages) {
		m.parts.forEach((part, i) => {
			const id = `${m.id}-${i}`;
			if (part.type === "text" && part.text?.trim()) rows.push({ kind: m.role === "user" ? "you" : "teacher", id, text: part.text });
			else if (m.role === "assistant" && part.type.startsWith("tool-"))
				changesOf(part.output).forEach((change, n) => rows.push({ kind: "change", id: `${id}-${n}`, change }));
		});
	}
	return rows;
}

/** Whether a row starts a new speaker's turn, so the script shows the name
 *  in the margin once per turn (a change row belongs to the teacher). */
export function startsTurn(rows: readonly TalkRow[], index: number): boolean {
	const who = (row: TalkRow | undefined) => (row ? (row.kind === "you" ? "you" : "teacher") : null);
	return who(rows[index]) !== who(rows[index - 1]);
}

/** The recorded action behind a change row (newest first), so a click can
 *  go there like the Activity rows do. Null once it left the recent list. */
export function actionFor(change: ClassChange, recent: readonly AgentAction[]): AgentAction | null {
	return recent.find((a) => a.label === change.label && a.page === change.page) ?? null;
}
