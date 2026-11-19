/**
 * The plan twins replay the shared cases the Rust server also replays
 * (crates/core/tests/study_golden.rs), so the two copies agree.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { planDays, type PlanTopic } from "../../src/shared/core/deadline-plan.ts";

interface Case {
	name: string;
	output: {
		args: {
			today: string;
			due?: string;
			topics?: PlanTopic[];
		};
		result: unknown;
	};
}

const cases = JSON.parse(readFileSync(new URL("../../crates/core/tests/golden/study.json", import.meta.url), "utf-8")) as Case[];

describe("deadline plan shared cases", () => {
	for (const { name, output } of cases) {
		const { args } = output;
		if (name.startsWith("plan days")) {
			it(name, () => assert.deepEqual(planDays(args.today, args.due!, args.topics!), output.result));
		}
	}
});
