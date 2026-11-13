/**
 * The topic parts twins replay the shared cases the Rust server also
 * replays (crates/core/tests/topic_parts_golden.rs), so both copies pick
 * the same page for each topic.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { LhMessage } from "../../src/shared/core/native-messages.ts";
import { topicParts } from "../../src/shared/core/topic-parts.ts";

interface Case {
	name: string;
	output: { args: { messages: LhMessage[] }; result: unknown };
}

const cases = JSON.parse(readFileSync(new URL("../../crates/core/tests/golden/topic_parts.json", import.meta.url), "utf-8")) as Case[];

describe("topic_parts shared cases", () => {
	for (const { name, output } of cases) {
		it(name, () => assert.deepEqual(topicParts(output.args.messages), output.result));
	}
});
