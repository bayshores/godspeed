import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveGeneral } from "../../src/frontend/components/settings-context-model.ts";

describe("liveGeneral", () => {
	it("boot's values until the record is read, and when the read failed", () => {
		const boot = { teacherName: "Ada", sounds: false, startupSound: true };
		const fromBoot = { teacherName: "Ada", sounds: false, startupSound: true };
		assert.deepEqual(liveGeneral(undefined, boot), fromBoot);
		assert.deepEqual(liveGeneral(null, boot), fromBoot);
	});

	it("the record once read, defaults for what it leaves out", () => {
		const boot = { teacherName: "Ada", sounds: false, startupSound: false };
		assert.deepEqual(liveGeneral({ version: 3 }, boot), { teacherName: "Teacher", sounds: true, startupSound: true });
		assert.deepEqual(liveGeneral({ version: 3, general: { teacherName: " Zed ", startupSound: false } }, boot), { teacherName: "Zed", sounds: true, startupSound: false });
	});

	it("a blank name is the default name", () => {
		assert.equal(liveGeneral(undefined, { teacherName: "  ", sounds: true, startupSound: true }).teacherName, "Teacher");
	});
});
