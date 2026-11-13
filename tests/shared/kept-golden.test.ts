/**
 * The kept card's twins replay the shared cases the Rust server also
 * replays (crates/core/tests/kept_golden.rs), so the window shows a kept
 * card, and its parts, exactly when the server lets him drop them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { LhMessage } from "../../src/shared/core/native-messages.ts";
import { joinKept, type KeptCardData } from "../../src/shared/core/kept-view.ts";
import type { LhViewMessage } from "../../src/shared/core/view.ts";

interface Case {
	name: string;
	output: { args: { messages: LhMessage[] }; result: Record<string, unknown> };
}

const cases = JSON.parse(readFileSync(new URL("../../crates/core/tests/golden/kept.json", import.meta.url), "utf-8")) as Case[];

/** Each quiz call's card as the cases write it: null, or its text and which parts show. */
function cards(messages: LhMessage[]): Record<string, unknown> {
	const parts = messages.flatMap((m) => (m.role === "assistant" ? m.content : [])).flatMap((b) => (b.type === "toolCall" && b.name === "quiz" ? [{ type: "tool-quiz", state: "output-available", toolCallId: b.id } as { toolCallId: string; kept?: KeptCardData }] : []));
	joinKept([{ parts }] as unknown as LhViewMessage[], messages);
	return Object.fromEntries(parts.map(({ toolCallId, kept: k }) => [toolCallId, k ? { text: k.text, analogy: !!k.fits && !k.analogyDropped, phrase: !!k.phrase && !k.phraseDropped, source: k.source ?? null } : null]));
}

describe("kept shared cases", () => {
	for (const { name, output } of cases) {
		it(name, () => assert.deepEqual(cards(output.args.messages), output.result));
	}
});
