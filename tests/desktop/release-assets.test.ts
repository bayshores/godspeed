import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { assetPlan, findBundled } from "../../scripts/release-assets.mjs";

describe("assetPlan", () => {
	it("names the Mac downloads and signs only the updater archive", () => {
		assert.deepEqual(assetPlan("mac", "0.6.0"), [
			{ from: "dmg/godspeed_0.6.0_aarch64.dmg", to: "godspeed-mac-apple-silicon.dmg", signed: false },
			{ from: "macos/godspeed.app.tar.gz", to: "godspeed-mac-apple-silicon.app.tar.gz", signed: true },
		]);
	});

	it("names the Windows and Linux downloads, each signed for latest.json", () => {
		assert.deepEqual(assetPlan("windows", "0.6.0"), [
			{ from: "nsis/godspeed_0.6.0_x64-setup.exe", to: "godspeed-windows-x64-setup.exe", signed: true },
		]);
		assert.deepEqual(assetPlan("linux", "0.6.0"), [
			{ from: "appimage/godspeed_0.6.0_amd64.AppImage", to: "godspeed-linux-x64.AppImage", signed: true },
			{ from: "deb/godspeed_0.6.0_amd64.deb", to: "godspeed-linux-x64.deb", signed: true },
		]);
	});

	it("has nothing for another platform", () => {
		assert.deepEqual(assetPlan("beos", "0.6.0"), []);
	});
});

describe("findBundled", () => {
	const bundleFolders = () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "gs-release-assets-"));
		const plain = path.join(root, "target-plain");
		const folders = [path.join(root, "target-triple"), plain];
		const put = (folder: string, relative: string) => {
			fs.mkdirSync(path.dirname(path.join(folder, relative)), { recursive: true });
			fs.writeFileSync(path.join(folder, relative), "x");
		};
		return { root, plain, folders, put };
	};

	it("finds a file in whichever folder holds it", () => {
		const { root, plain, folders, put } = bundleFolders();
		try {
			put(plain, "macos/godspeed.app.tar.gz");
			assert.equal(findBundled(folders, "macos/godspeed.app.tar.gz"), path.join(plain, "macos/godspeed.app.tar.gz"));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses a missing file", () => {
		const { root, folders } = bundleFolders();
		try {
			assert.throws(() => findBundled(folders, "macos/godspeed.app.tar.gz.sig"), /is missing/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses a file left in both folders, since one is from an older build", () => {
		const { root, folders, put } = bundleFolders();
		try {
			for (const folder of folders) put(folder, "macos/godspeed.app.tar.gz");
			assert.throws(() => findBundled(folders, "macos/godspeed.app.tar.gz"), /more than one bundle folder/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
