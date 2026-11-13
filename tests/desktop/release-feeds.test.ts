import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { legacyFeed, macFeed, restageMacFeed, stagingShare, tauriFeed } from "../../scripts/release-feeds.mjs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load(source: string): any };
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = path.join(repoRoot, "scripts", "release-feeds.mjs");
const DATE = "2026-11-12T10:00:00.000Z";
const zip = { url: "godspeed-0.6.0-arm64-mac.zip", sha512: "zipsha", size: 7 };
const dmg = { url: "godspeed-mac-apple-silicon.dmg", sha512: "dmgsha", size: 9 };

describe("tauriFeed", () => {
	it("names each platform's own download in this version's release, with its signature", () => {
		const feed = JSON.parse(tauriFeed("0.6.0", DATE, {
			"darwin-aarch64-app": "s-mac", "windows-x86_64-nsis": "s-win", "linux-x86_64-appimage": "s-appimage", "linux-x86_64-deb": "s-deb",
		}));
		const base = "https://github.com/bayshores/godspeed/releases/download/v0.6.0";
		assert.deepEqual(feed, {
			version: "0.6.0",
			pub_date: DATE,
			platforms: {
				"darwin-aarch64-app": { signature: "s-mac", url: `${base}/godspeed-mac-apple-silicon.app.tar.gz` },
				"windows-x86_64-nsis": { signature: "s-win", url: `${base}/godspeed-windows-x64-setup.exe` },
				"linux-x86_64-appimage": { signature: "s-appimage", url: `${base}/godspeed-linux-x64.AppImage` },
				"linux-x86_64-deb": { signature: "s-deb", url: `${base}/godspeed-linux-x64.deb` },
			},
		});
	});
});

describe("macFeed", () => {
	it("puts the zip first, backs the legacy fields with it, and stops Macs below macOS 14", () => {
		assert.equal(
			macFeed({ version: "0.6.0", zip, dmg, releaseDate: DATE, staging: 10 }),
			[
				"version: 0.6.0",
				"files:",
				"  - url: godspeed-0.6.0-arm64-mac.zip",
				"    sha512: zipsha",
				"    size: 7",
				"  - url: godspeed-mac-apple-silicon.dmg",
				"    sha512: dmgsha",
				"    size: 9",
				"path: godspeed-0.6.0-arm64-mac.zip",
				"sha512: zipsha",
				`releaseDate: '${DATE}'`,
				"minimumSystemVersion: 23.0.0",
				"stagingPercentage: 10",
				"",
			].join("\n"),
		);
	});

	it("reads back as electron-updater reads it", () => {
		const info = yaml.load(macFeed({ version: "0.6.0", zip, dmg, releaseDate: DATE, staging: 0 }));
		assert.equal(info.version, "0.6.0");
		assert.equal(info.minimumSystemVersion, "23.0.0");
		assert.equal(info.stagingPercentage, 0, "0 offers it to no one");
	});

	it("writes no share at 100, which means everyone", () => {
		assert.doesNotMatch(macFeed({ version: "0.6.0", zip, dmg, releaseDate: DATE, staging: 100 }), /stagingPercentage/);
	});

	it("restaging changes only the share", () => {
		const first = macFeed({ version: "0.6.0", zip, dmg, releaseDate: DATE, staging: 10 });
		assert.equal(restageMacFeed(first, 50), first.replace("stagingPercentage: 10", "stagingPercentage: 50"));
		assert.equal(restageMacFeed(first, 100), first.replace("stagingPercentage: 10\n", ""));
		assert.throws(() => restageMacFeed("version: 0.6.0\n", 50), /not a feed this script wrote/);
	});
});

describe("stagingShare", () => {
	it("takes a whole number from 0 to 100 and nothing else", () => {
		assert.equal(stagingShare("0"), 0);
		assert.equal(stagingShare("10"), 10);
		assert.equal(stagingShare("100"), 100);
		for (const bad of ["", "101", "-1", "10.5", "ten", undefined]) assert.throws(() => stagingShare(bad as string), /whole number from 0 to 100/);
	});
});

describe("legacyFeed", () => {
	it("is the template unchanged with the new version added", () => {
		assert.equal(legacyFeed("version: 0.5.51\n", "0.6.0"), "version: 0.5.51\nnewApp: 0.6.0\n");
	});
});

describe("release-feeds.mjs (CLI)", () => {
	const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
	const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });

	/** A dist/ folder as the three packaging jobs leave it. */
	function dist() {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-release-feeds-"));
		const put = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);
		put(`godspeed-${version}-arm64-mac.zip`, "zip bytes");
		put("godspeed-mac-apple-silicon.dmg", "dmg bytes!");
		for (const name of ["godspeed-mac-apple-silicon.app.tar.gz", "godspeed-windows-x64-setup.exe", "godspeed-linux-x64.AppImage", "godspeed-linux-x64.deb"]) {
			put(name, "x");
			put(`${name}.sig`, `sig-of-${name}\n`);
		}
		return dir;
	}

	it("writes the four feeds from the downloads, the signatures and the templates", () => {
		const dir = dist();
		try {
			const result = run([dir, "--mac-staging", "10"]);
			assert.equal(result.status, 0, result.stderr);
			const tauri = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
			assert.equal(tauri.version, version);
			assert.equal(tauri.platforms["linux-x86_64-deb"].signature, "sig-of-godspeed-linux-x64.deb", "the .sig text, trimmed");
			const mac = yaml.load(fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8"));
			const digest = (text: string) => createHash("sha512").update(text).digest("base64");
			assert.deepEqual(mac.files, [
				{ url: `godspeed-${version}-arm64-mac.zip`, sha512: digest("zip bytes"), size: 9 },
				{ url: "godspeed-mac-apple-silicon.dmg", sha512: digest("dmg bytes!"), size: 10 },
			]);
			assert.equal(mac.stagingPercentage, 10);
			for (const [feed, template] of [["latest.yml", "legacy-latest.yml"], ["latest-linux.yml", "legacy-latest-linux.yml"]]) {
				const text = fs.readFileSync(path.join(repoRoot, "crates", "shell", "release", template!), "utf8");
				assert.equal(fs.readFileSync(path.join(dir, feed!), "utf8"), `${text}newApp: ${version}\n`);
			}

			const restaged = run([dir, "--mac-staging", "50", "--mac-only"]);
			assert.equal(restaged.status, 0, restaged.stderr);
			assert.equal(yaml.load(fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8")).stagingPercentage, 50);
			assert.deepEqual(yaml.load(fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8")).files, mac.files);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses when a download or a signature is missing", () => {
		const dir = dist();
		try {
			fs.rmSync(path.join(dir, "godspeed-windows-x64-setup.exe.sig"));
			const result = run([dir, "--mac-staging", "10"]);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /godspeed-windows-x64-setup\.exe\.sig is missing/);
			assert.equal(fs.existsSync(path.join(dir, "latest.json")), false, "no feed is written");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("needs a folder and a share", () => {
		assert.match(run(["--mac-staging", "10"]).stderr, /usage/);
		assert.match(run([os.tmpdir()]).stderr, /usage/);
	});
});
