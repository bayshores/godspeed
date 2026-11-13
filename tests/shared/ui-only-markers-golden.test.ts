/**
 * The UI-only marker list's twin replays the shared cases the Rust server
 * also replays (crates/core/tests/ui_only_markers_golden.rs), so the two
 * lists cannot drift.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { danglingQuestionOf, needsContinuation, sideHeldQuestions, type LhMessage } from "../../src/shared/core/native-messages.ts";

interface Case {
	name: string;
	aroundSideQuestion: LhMessage[];
	held: Array<[string, { callAt: number; sideAt: number }]>;
	dangling: string | null;
	midTurn: LhMessage[];
	needsContinuation: boolean;
}

const cases = JSON.parse(readFileSync(new URL("../../crates/core/tests/golden/ui_only_markers.json", import.meta.url), "utf-8")) as Case[];

describe("ui_only_markers shared cases", () => {
	for (const c of cases) {
		it(c.name, () => {
			assert.deepEqual([...sideHeldQuestions(c.aroundSideQuestion)].sort(), c.held, "held");
			assert.equal(danglingQuestionOf(c.aroundSideQuestion)?.toolCallId ?? null, c.dangling, "dangling");
			assert.equal(needsContinuation(c.midTurn), c.needsContinuation, "a marker written mid-turn");
		});
	}
});
