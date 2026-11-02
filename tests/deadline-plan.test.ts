/**
 * The path to a deadline: weak, then not tried, then shaky topics, spread
 * over the days before it's due, today first.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDays, topicsToWorkOn } from "../src/core/deadline-plan.ts";

const t = (id: string, rate: number | null) => ({ id, name: id, rate });

describe("the path to a deadline", () => {
	it("works on weak, then not tried, then shaky, and leaves strong out", () => {
		const order = topicsToWorkOn([t("strong", 0.9), t("shaky", 0.7), t("new", null), t("weak", 0.5), t("weaker", 0.2), t("new2", null)]);
		assert.deepEqual(order.map((x) => x.id), ["weaker", "weak", "new", "new2", "shaky"]);
	});
	it("spreads the topics over the days before the deadline, today first", () => {
		const plan = planDays("2026-11-02", "2026-11-06", [t("a", 0.1), t("b", 0.2), t("c", 0.3), t("d", 0.4), t("e", 0.5), t("f", null)]);
		assert.deepEqual(
			plan.map((p) => [p.day, p.topics.map((x) => x.id)]),
			[
				["2026-11-02", ["a", "b"]],
				["2026-11-03", ["c", "d"]],
				["2026-11-04", ["e"]],
				["2026-11-05", ["f"]],
			],
		);
	});
	it("fewer topics than days uses the first days", () => {
		const plan = planDays("2026-11-02", "2026-11-12", [t("a", null), t("b", 0.6)]);
		assert.deepEqual(plan.map((p) => p.day), ["2026-11-02", "2026-11-03"]);
	});
	it("due today puts everything on today; past or nothing to do plans nothing", () => {
		const plan = planDays("2026-11-06", "2026-11-06", [t("a", null), t("b", 0.3)]);
		assert.deepEqual(plan, [{ day: "2026-11-06", topics: [t("b", 0.3), t("a", null)] }]);
		assert.deepEqual(planDays("2026-11-07", "2026-11-06", [t("a", null)]), []);
		assert.deepEqual(planDays("2026-11-02", "2026-11-06", [t("a", 0.95)]), []);
		assert.deepEqual(planDays("2026-11-02", "2026-11-06", []), []);
	});
	it("crosses month ends", () => {
		assert.deepEqual(planDays("2026-10-31", "2026-11-02", [t("a", null), t("b", null)]).map((p) => p.day), ["2026-10-31", "2026-11-01"]);
	});
});
