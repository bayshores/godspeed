/**
 * The stop and opener twins replay the shared cases the Rust server also
 * replays (crates/core/tests/topic_end_golden.rs), so the two copies agree.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PlanTree } from "../../src/shared/core/contracts/plan.ts";
import type { LhMessage } from "../../src/shared/core/native-messages.ts";
import { lessonStop, shownOpeners } from "../../src/shared/core/topic-end.ts";

interface Case {
	name: string;
	output: { args: { messages: LhMessage[]; tree?: PlanTree | null; homework?: Array<{ number: string; done: boolean }> }; result: unknown };
}

const cases = JSON.parse(readFileSync(new URL("../../crates/core/tests/golden/topic_end.json", import.meta.url), "utf-8")) as Case[];

describe("topic_end shared cases", () => {
	for (const { name, output } of cases) {
		it(name, () => {
			const { messages, tree, homework } = output.args;
			const got = name.startsWith("lesson_stop:") ? lessonStop(messages, tree, homework) : Object.fromEntries(shownOpeners(messages));
			assert.deepEqual(got, output.result);
		});
	}
});
