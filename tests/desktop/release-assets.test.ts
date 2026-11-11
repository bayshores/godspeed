import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assetPlan } from "../../scripts/release-assets.mjs";

describe("assetPlan", () => {
	it("names the Mac downloads and the updater archive", () => {
		assert.deepEqual(assetPlan("mac", "0.6.0"), [
			{ from: "dmg/godspeed_0.6.0_aarch64.dmg", to: "godspeed-mac-apple-silicon.dmg" },
			{ from: "macos/godspeed.app.tar.gz", to: "godspeed-mac-apple-silicon.app.tar.gz" },
		]);
	});

	it("names the Windows and Linux downloads", () => {
		assert.deepEqual(assetPlan("windows", "0.6.0"), [{ from: "nsis/godspeed_0.6.0_x64-setup.exe", to: "godspeed-windows-x64-setup.exe" }]);
		assert.deepEqual(
			assetPlan("linux", "0.6.0").map((asset) => asset.to),
			["godspeed-linux-x64.AppImage", "godspeed-linux-x64.deb"],
		);
	});

	it("has nothing for another platform", () => {
		assert.deepEqual(assetPlan("beos", "0.6.0"), []);
	});
});
