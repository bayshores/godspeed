/**
 * Cluster presentation-rule tests. Wave 7 killed the semantic detection
 * AND the LLM label matcher (birth-session clusters, session-name labels —
 * core/session-clusters.ts has its own suite); what remains pinned here
 * is the render threshold.
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { MIN_CLUSTER_SIZE } from "../src/core/clusters.ts";

describe("MIN_CLUSTER_SIZE", () => {
	test("is 3 (the render threshold — below this, no hull)", () => {
		assert.equal(MIN_CLUSTER_SIZE, 3);
	});
});
