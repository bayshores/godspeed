/**
 * The kept card in the view. A quiz call shows as the kept card only when
 * it carries a `keep`, the server's keep-check said "shown", and his answer
 * was right (not I don't know, not skipped). Every other case keeps the
 * shipped answered card. The analogy lines and the phrase show unless the
 * last drop marker of their kind for that quiz took them away. Twin of the
 * server's crates/core/src/study/kept.rs; both replay
 * crates/core/tests/golden/kept.json. Pure and browser-safe.
 */
import type { LhMessage } from "./native-messages.ts";
import type { KeepCheckDetails, KeptDropDetails } from "./contracts/chat.ts";
import type { LhViewMessage } from "./view.ts";

/** What a kept card shows. Flat, so an unchanged card compares equal and
 *  its row skips the redraw. `source` is a stored source mark. */
export interface KeptCardData {
	text: string;
	fits?: string;
	stops?: string;
	analogyDropped?: boolean;
	phrase?: string;
	phraseDropped?: boolean;
	source?: string;
}

/** A stored call's `keep`: an object, or the same as a JSON string. */
function keepOf(args: unknown): Record<string, unknown> | null {
	let keep = (args as { keep?: unknown } | null | undefined)?.keep;
	if (typeof keep === "string") {
		try {
			keep = JSON.parse(keep);
		} catch {
			return null;
		}
	}
	return keep && typeof keep === "object" && !Array.isArray(keep) ? (keep as Record<string, unknown>) : null;
}

const textOf = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value : undefined);

/** A right answer that counts: graded right, not I don't know, not skipped
 *  (any truthy flag, as the server's answer_outcome reads them). */
function rightAnswer(details: unknown): boolean {
	const d = details as { kind?: unknown; correct?: unknown; dontKnow?: unknown; dismissed?: unknown } | null | undefined;
	return d?.kind === "quiz" && d.correct === true && !d.dontKnow && !d.dismissed;
}

/** Each quiz call that shows as a kept card, by its call id. */
function keptCards(messages: readonly LhMessage[]): Map<string, KeptCardData> {
	const keeps = new Map<string, Record<string, unknown>>();
	const verdicts = new Map<string, KeepCheckDetails>();
	const right = new Map<string, boolean>();
	const analogyDropped = new Map<string, boolean>();
	const phraseDropped = new Map<string, boolean>();
	for (const m of messages) {
		if (m.role === "assistant") {
			for (const block of m.content) {
				if (block.type !== "toolCall" || block.name !== "quiz") continue;
				const keep = keepOf(block.arguments);
				if (keep) keeps.set(block.id, keep);
			}
		} else if (m.role === "toolResult") {
			right.set(m.toolCallId, rightAnswer(m.details));
		} else if (m.role === "custom") {
			if (m.customType === "keep-check") {
				const d = m.details as KeepCheckDetails | null | undefined;
				if (typeof d?.quizCallId === "string") verdicts.set(d.quizCallId, d);
			} else if (m.customType === "analogy-drop" || m.customType === "phrase-drop") {
				const d = m.details as KeptDropDetails | null | undefined;
				if (typeof d?.of !== "string") continue;
				(m.customType === "analogy-drop" ? analogyDropped : phraseDropped).set(d.of, !d.back);
			}
		}
	}
	const cards = new Map<string, KeptCardData>();
	for (const [callId, keep] of keeps) {
		const verdict = verdicts.get(callId);
		const text = textOf(keep.text);
		if (!text || verdict?.keep !== "shown" || right.get(callId) !== true) continue;
		const card: KeptCardData = { text };
		const fits = textOf(keep.fits);
		const stops = textOf(keep.stops);
		if (verdict.fits === true && fits && stops) Object.assign(card, { fits, stops, analogyDropped: analogyDropped.get(callId) === true });
		const phrase = textOf(keep.phrase);
		if (verdict.phrase === true && phrase) Object.assign(card, { phrase, phraseDropped: phraseDropped.get(callId) === true });
		if (verdict.source === "ok" && typeof verdict.sourceMark === "string") card.source = verdict.sourceMark;
		cards.set(callId, card);
	}
	return cards;
}

/** Puts `kept` on each answered quiz part that shows as a kept card, in
 *  place (the view's parts are made fresh by every projection). The part
 *  stays a quiz part, so the step bar and the answer anchors still find it. */
export function joinKept(view: LhViewMessage[], messages: readonly LhMessage[]): void {
	const cards = keptCards(messages);
	if (cards.size === 0) return;
	for (const m of view) {
		for (const part of m.parts) {
			if (part.type !== "tool-quiz" || part.state !== "output-available" || !part.toolCallId) continue;
			const card = cards.get(part.toolCallId);
			if (card) part.kept = card;
		}
	}
}
