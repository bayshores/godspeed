/**
 * Tests for the settings record's core layer: the factory defaults. The
 * server cleans the record (crates/core/src/records/settings.rs); resolution
 * is tested in settings-resolution.test.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CURRENT_SETTINGS_VERSION,
	FACTORY_SETTINGS,
} from "../../src/shared/core/settings.ts";

describe("FACTORY_SETTINGS (the compiled factory layer)", () => {
	it("pins the factory defaults", () => {
		assert.equal(CURRENT_SETTINGS_VERSION, 3);
		assert.equal("compaction" in FACTORY_SETTINGS, false, "the summarize point is fixed, not a setting");
		assert.deepEqual(FACTORY_SETTINGS.general, { autoUpdate: true, activeSpace: "none", teacherName: "Teacher", startupSound: true, sounds: true, deadlineReminders: true });
		// the master switch ONLY
		assert.deepEqual(FACTORY_SETTINGS.graph, { enabled: true });
		const a = FACTORY_SETTINGS.appearance;
		assert.equal(a.background, null); // Graphite
		assert.equal(a.fontFamily, null); // Literata
		assert.equal("proseFontSize" in a, false);
		assert.equal("mdRendering" in a, false);
	});

	it("has NO factory model pin — chat defaults and role overrides start absent", () => {
		assert.equal("chat" in FACTORY_SETTINGS, false);
		assert.equal("agent" in FACTORY_SETTINGS, false);
	});
});
