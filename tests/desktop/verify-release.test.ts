/**
 * The final release gate (scripts/verify-release.ts): pure-function tests plus CLI runs, all
 * offline. The healthy feeds come from scripts/release-feeds.mjs, so the feeds a release writes are
 * the feeds this gate accepts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
	checkVersion, expectedAssets, isPlainAssetName, LEGACY_TEMPLATES, normalizeReleasePages,
	parseReleases, selectDraft, verifyAssets, verifyConfigAssumptions, verifyFeeds,
	type ReleaseAsset, type ReleaseRecord,
} from "../../scripts/verify-release.ts";
import { legacyFeed, macFeed, tauriFeed } from "../../scripts/release-feeds.mjs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load(source: string): any };
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const script = path.join(repoRoot, "scripts", "verify-release.ts");
const releaseDir = path.join(repoRoot, "crates", "shell", "release");
const VERSION = "0.2.0";
const TAG = `v${VERSION}`;
const NOW = "2026-11-12T10:00:00.000Z";

/** A base64-looking sha512 (the gate checks shape, not the digest). */
const sha512 = (seed: string) => Buffer.from(seed.padEnd(64, "0")).toString("base64");
/** A `.sig` file's text as the bundler writes it for `version`. */
const signature = (version: string, file = "x") =>
	Buffer.from(
		"untrusted comment: signature from tauri secret key\nRUQy9ev4aR89LuWPzHIWi1yg\n" +
		`trusted comment: timestamp:1794536654\tfile:${file}\tversion:${version}\nZBGjkwkTJWB/Tcy5T6CMvE==`,
	).toString("base64");

function asset(id: number, name: string, overrides: Partial<ReleaseAsset> = {}): ReleaseAsset {
	return { id, name, size: 5000, state: "uploaded", ...overrides };
}

/** The complete, healthy ten-asset draft for a version. */
function healthyRelease(version: string, tagForm: "v" | "bare" = "v"): ReleaseRecord {
	return {
		id: 42,
		tag_name: tagForm === "v" ? `v${version}` : version,
		draft: true,
		assets: expectedAssets(version).files.map((name, index) => asset(1000 + index, name)),
	};
}

const templates = () =>
	Object.fromEntries(Object.entries(LEGACY_TEMPLATES).map(([feed, file]) => [feed, fs.readFileSync(path.join(releaseDir, file), "utf8")]));

/** The four feeds exactly as scripts/release-feeds.mjs writes them. */
function healthyFeeds(version: string, staging = 10): Record<string, string> {
	const e = expectedAssets(version);
	const keys = ["darwin-aarch64-app", "windows-x86_64-nsis", "linux-x86_64-appimage", "linux-x86_64-deb"];
	const feeds: Record<string, string> = {
		[e.tauriFeed]: tauriFeed(version, NOW, Object.fromEntries(keys.map((key) => [key, signature(version)]))),
		[e.mac.feed]: macFeed({
			version,
			zip: { url: e.mac.zip, sha512: sha512(e.mac.zip), size: 5000 },
			dmg: { url: e.mac.dmg, sha512: sha512(e.mac.dmg), size: 5000 },
			releaseDate: NOW,
			staging,
		}),
	};
	for (const [feed, template] of Object.entries(templates())) feeds[feed] = legacyFeed(template, version);
	return feeds;
}

const check = (feeds: Record<string, string>, release = healthyRelease(VERSION), legacy = templates()) =>
	verifyFeeds(feeds, legacy, release, expectedAssets(VERSION));

describe("release gate: expected asset inventory", () => {
	it("is exactly the ten release files for the version", () => {
		assert.deepEqual(expectedAssets(VERSION).files, [
			"godspeed-mac-apple-silicon.dmg",
			"godspeed-windows-x64-setup.exe",
			"godspeed-linux-x64.AppImage",
			"godspeed-linux-x64.deb",
			"godspeed-mac-apple-silicon.app.tar.gz",
			"latest.json",
			"godspeed-0.2.0-arm64-mac.zip",
			"latest-mac.yml",
			"latest.yml",
			"latest-linux.yml",
		]);
	});

	it("matches the download links on the release page", () => {
		const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
		const { mac, win, linux } = expectedAssets(VERSION);
		for (const name of [mac.dmg, win.exe, linux.appImage, linux.deb]) {
			assert.ok(workflow.includes(`link("${name}")`), `release.yml should link ${name}`);
		}
	});

	it("accepts plain semver versions and nothing else", () => {
		assert.ok(checkVersion("1.2.3").ok);
		assert.ok(checkVersion("1.2.3-beta.1").ok);
		assert.ok(!checkVersion("1.2").ok);
		assert.ok(!checkVersion("0.2.0 ; rm -rf").ok);
		assert.ok(!checkVersion(undefined).ok);
	});
});

describe("release gate: release-list parsing", () => {
	it("flattens gh --paginate --slurp pages and accepts a plain array", () => {
		const release = healthyRelease(VERSION);
		const paged = normalizeReleasePages([[release], [], [release]]);
		assert.ok(paged.ok);
		assert.deepEqual(paged.releases, [release, release]);
		const plain = normalizeReleasePages([release]);
		assert.ok(plain.ok);
		assert.deepEqual(plain.releases, [release]);
	});

	it("fails closed on a non-array document", () => {
		assert.ok(!normalizeReleasePages({ message: "Bad credentials" }).ok);
	});

	it("rejects malformed release entries and assets", () => {
		assert.ok(!parseReleases([{ id: 1, tag_name: "v0.2.0", draft: "yes", assets: [] }]).ok);
		assert.ok(!parseReleases([{ id: 1, tag_name: "v0.2.0", draft: true, assets: [{ id: 1, name: "x", size: 1, state: "" }] }]).ok);
		assert.ok(parseReleases([healthyRelease(VERSION)]).ok);
	});
});

describe("release gate: draft selection", () => {
	it("selects the single draft carrying the v-tag", () => {
		const selection = selectDraft([healthyRelease(VERSION)], TAG, VERSION);
		assert.ok(selection.ok && selection.release.id === 42 && selection.warnings.length === 0);
	});

	it("still matches the unprefixed tag form but reports the hazard", () => {
		const selection = selectDraft([healthyRelease(VERSION, "bare")], TAG, VERSION);
		assert.ok(selection.ok);
		assert.equal(selection.warnings.length, 1);
		assert.match(selection.warnings[0]!, /unprefixed tag "0.2.0"/);
		assert.match(selection.warnings[0]!, /SECOND draft/);
	});

	it("fails when nothing matches", () => {
		const selection = selectDraft([healthyRelease("0.1.0")], TAG, VERSION);
		assert.ok(!selection.ok);
		assert.match(selection.errors.join("\n"), /no release matches/);
	});

	it("fails when the match is already published", () => {
		const selection = selectDraft([{ ...healthyRelease(VERSION), draft: false }], TAG, VERSION);
		assert.ok(!selection.ok);
		assert.match(selection.errors.join("\n"), /already published/);
	});

	it("fails on a v-tag draft and a bare-version draft together", () => {
		const selection = selectDraft([healthyRelease(VERSION), healthyRelease(VERSION, "bare")], TAG, VERSION);
		assert.ok(!selection.ok);
		assert.match(selection.errors.join("\n"), /2 releases match/);
	});
});

describe("release gate: packaging config drift guard", () => {
	const realConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "crates", "shell", "tauri.conf.json"), "utf8"));
	const realPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

	it("accepts the repository's real configuration", () => {
		const verdict = verifyConfigAssumptions(realConfig, realPkg);
		assert.ok(verdict.ok, JSON.stringify(verdict, null, 2));
	});

	const drifts: Array<[string, (config: any) => void, RegExp]> = [
		["productName", (config) => { config.productName = "Godspeed"; }, /productName is "Godspeed"/],
		["mainBinaryName", (config) => { config.mainBinaryName = "app"; }, /mainBinaryName/],
		["identifier", (config) => { config.identifier = "com.example.godspeed"; }, /identifier/],
		["version source", (config) => { config.version = "0.6.0"; }, /version is "0\.6\.0"/],
		["bundle targets", (config) => { config.bundle.targets = ["app", "dmg", "msi"]; }, /bundle\.targets/],
		["updater artifacts", (config) => { config.bundle.createUpdaterArtifacts = "v1Compatible"; }, /createUpdaterArtifacts/],
		["Mac minimum", (config) => { config.bundle.macOS.minimumSystemVersion = "13.0"; }, /minimumSystemVersion/],
		["updater endpoint", (config) => { config.plugins.updater.endpoints = ["https://example.com/latest.json"]; }, /endpoints/],
		["empty pubkey", (config) => { config.plugins.updater.pubkey = ""; }, /pubkey is empty/],
		["missing pubkey", (config) => { delete config.plugins.updater.pubkey; }, /pubkey is empty/],
	];
	for (const [label, mutate, pattern] of drifts) {
		it(`fails when the ${label} drifts`, () => {
			const config = structuredClone(realConfig);
			mutate(config);
			const verdict = verifyConfigAssumptions(config, realPkg);
			assert.ok(!verdict.ok);
			assert.match(verdict.errors.join("\n"), pattern);
		});
	}

	it("fails when package.json is no longer godspeed", () => {
		const verdict = verifyConfigAssumptions(realConfig, { ...realPkg, name: "other" });
		assert.ok(!verdict.ok);
		assert.match(verdict.errors.join("\n"), /no longer "godspeed"/);
	});
});

describe("release gate: asset inventory", () => {
	it("passes a complete draft and names every deviation", () => {
		assert.ok(verifyAssets(healthyRelease(VERSION), expectedAssets(VERSION)).ok);
		const release = healthyRelease(VERSION);
		release.assets = release.assets.filter((entry) => entry.name !== "latest.json");
		release.assets.push(asset(9999, "godspeed-mac-apple-silicon.dmg.blockmap"));
		release.assets.push(asset(9998, "godspeed-0.1.0-arm64-mac.zip"));
		release.assets.push(asset(9997, "godspeed-mac-apple-silicon.dmg", { size: 0 }));
		release.assets.push(asset(9996, "godspeed-mac-apple-silicon.dmg", { state: "starter" }));
		const verdict = verifyAssets(release, expectedAssets(VERSION));
		assert.ok(!verdict.ok);
		const joined = verdict.errors.join("\n");
		assert.match(joined, /latest\.json: missing/);
		assert.match(joined, /dmg\.blockmap: unexpected/);
		assert.match(joined, /0\.1\.0-arm64-mac\.zip: unexpected/);
		assert.match(joined, /duplicate asset name/);
		assert.match(joined, /zero-size/);
		assert.match(joined, /state is "starter"/);
	});
});

describe("release gate: feed reference hygiene", () => {
	it("accepts bare asset names only", () => {
		assert.ok(isPlainAssetName("godspeed-mac-apple-silicon.dmg"));
		for (const bad of ["", ".", "..", "../godspeed.zip", "dist/godspeed.zip", "https://evil.example/app.zip",
			"http://evil.example/app.zip", "file:///etc/passwd", "C:\\app.zip", "~x/app.zip", "app.zip?q=1", "app.zip#x"]) {
			assert.equal(isPlainAssetName(bad), false, bad);
		}
	});

	it("the committed legacy templates are 0.5.51's feeds pointing into its own release", () => {
		for (const [feed, text] of Object.entries(templates())) {
			const info = yaml.load(text);
			assert.equal(info.version, "0.5.51", feed);
			assert.equal(info.newApp, undefined, `${feed}: newApp is added at release time`);
			for (const entry of info.files) assert.match(entry.url, /^\.\.\/v0\.5\.51\/godspeed-[^/]+$/, feed);
			assert.match(info.path, /^\.\.\/v0\.5\.51\//, feed);
		}
	});
});

describe("release gate: update feeds", () => {
	it("accepts the feeds release-feeds.mjs writes, with or without a staged share", () => {
		for (const staging of [0, 10, 50, 99, 100]) {
			const verdict = check(healthyFeeds(VERSION, staging));
			assert.ok(verdict.ok, `${staging}: ${JSON.stringify(verdict, null, 2)}`);
		}
	});

	type Mutation = (feeds: Record<string, string>) => void;
	const e = expectedAssets(VERSION);
	const json = (feeds: Record<string, string>, change: (info: any) => void) => {
		const info = JSON.parse(feeds["latest.json"]!);
		change(info);
		feeds["latest.json"] = JSON.stringify(info);
	};
	const mutations: Array<[string, Mutation, RegExp]> = [
		// latest.json
		["a wrong version in latest.json", (f) => json(f, (info) => { info.version = "0.3.0"; }), /latest\.json: version is "0\.3\.0"/],
		["a missing platform key", (f) => json(f, (info) => { delete info.platforms["linux-x86_64-deb"]; }), /platforms are \[.*\] but must be exactly/],
		["an extra platform key", (f) => json(f, (info) => { info.platforms["darwin-x86_64"] = info.platforms["darwin-aarch64-app"]; }), /must be exactly/],
		["a URL into another release", (f) => json(f, (info) => { info.platforms["windows-x86_64-nsis"].url = `https://github.com/bayshores/godspeed/releases/download/v0.1.0/${e.win.exe}`; }), /windows-x86_64-nsis\.url/],
		["a URL on another host", (f) => json(f, (info) => { info.platforms["darwin-aarch64-app"].url = `https://evil.example/${e.mac.archive}`; }), /darwin-aarch64-app\.url/],
		["the wrong asset under a key", (f) => json(f, (info) => { info.platforms["linux-x86_64-deb"].url = `https://github.com/bayshores/godspeed/releases/download/v${VERSION}/${e.linux.appImage}`; }), /linux-x86_64-deb\.url/],
		["an empty signature", (f) => json(f, (info) => { info.platforms["linux-x86_64-appimage"].signature = ""; }), /linux-x86_64-appimage\.signature/],
		["a signature for another version", (f) => json(f, (info) => { info.platforms["darwin-aarch64-app"].signature = signature("0.1.0"); }), /darwin-aarch64-app\.signature/],
		["a signature that is not one", (f) => json(f, (info) => { info.platforms["windows-x86_64-nsis"].signature = "c2lnbmF0dXJl"; }), /windows-x86_64-nsis\.signature/],
		["a bad pub_date", (f) => json(f, (info) => { info.pub_date = "yesterday"; }), /pub_date/],
		["an unparseable latest.json", (f) => { f["latest.json"] = "{"; }, /latest\.json: does not parse as JSON/],
		// latest-mac.yml
		["a wrong version in latest-mac.yml", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace(`version: ${VERSION}`, "version: 0.3.0"); }, /latest-mac\.yml: version is "0\.3\.0"/],
		["the DMG first", (f) => {
			f["latest-mac.yml"] = macFeed({ version: VERSION, zip: { url: e.mac.dmg, sha512: sha512(e.mac.dmg), size: 5000 }, dmg: { url: e.mac.zip, sha512: sha512(e.mac.zip), size: 5000 }, releaseDate: NOW, staging: 10 });
		}, /the zip first/],
		["a legacy path away from files[0]", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace(`path: ${e.mac.zip}`, `path: ${e.mac.dmg}`); }, /top-level path is/],
		["a legacy sha512 not matching files[0]", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace(`sha512: ${sha512(e.mac.zip)}\nreleaseDate`, `sha512: ${sha512("tampered")}\nreleaseDate`); }, /top-level sha512 does not match/],
		["a size disagreeing with the upload", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace("size: 5000", "size: 4999"); }, /size 4999 ≠ release asset size 5000/],
		["a path in a file URL", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace(`url: ${e.mac.zip}`, `url: ../v0.1.0/${e.mac.zip}`); }, /files\[0\]\.url is not a bare asset name/],
		["a garbage sha512", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace(`sha512: ${sha512(e.mac.dmg)}`, "sha512: deadbeef"); }, /sha512 is not a base64 digest/],
		["a wrong minimum system", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace("minimumSystemVersion: 23.0.0", "minimumSystemVersion: 22.0.0"); }, /minimumSystemVersion is "22\.0\.0"/],
		["no minimum system", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace("minimumSystemVersion: 23.0.0\n", ""); }, /minimumSystemVersion is undefined/],
		["a share of 100", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace("stagingPercentage: 10", "stagingPercentage: 100"); }, /stagingPercentage is 100/],
		["a share that is not a whole number", (f) => { f["latest-mac.yml"] = f["latest-mac.yml"]!.replace("stagingPercentage: 10", "stagingPercentage: '10'"); }, /stagingPercentage is "10"/],
		["an unknown field", (f) => { f["latest-mac.yml"] += "newApp: 0.2.0\n"; }, /latest-mac\.yml: unexpected field "newApp"/],
		["an unparseable latest-mac.yml", (f) => { f["latest-mac.yml"] = "\tversion: [unclosed"; }, /does not parse as YAML/],
		// latest.yml, latest-linux.yml
		["no newApp", (f) => { f["latest.yml"] = templates()["latest.yml"]!; }, /latest\.yml: is not its committed template plus "newApp: 0\.2\.0"/],
		["a wrong newApp", (f) => { f["latest-linux.yml"] = legacyFeed(templates()["latest-linux.yml"]!, "0.1.0"); }, /latest-linux\.yml: is not its committed template/],
		["a changed file entry", (f) => { f["latest.yml"] = f["latest.yml"]!.replace("size: 220792779", "size: 1"); }, /latest\.yml: is not its committed template/],
		["the new version in a legacy feed", (f) => { f["latest-linux.yml"] = f["latest-linux.yml"]!.replace("version: 0.5.51", `version: ${VERSION}`); }, /latest-linux\.yml: is not its committed template/],
		["a feed not downloaded", (f) => { delete f["latest-linux.yml"]; }, /latest-linux\.yml: not downloaded/],
	];
	for (const [label, mutate, pattern] of mutations) {
		it(`fails on ${label}`, () => {
			const feeds = healthyFeeds(VERSION);
			mutate(feeds);
			const verdict = check(feeds);
			assert.ok(!verdict.ok, `expected failure for: ${label}`);
			assert.match(verdict.errors.join("\n"), pattern);
		});
	}

	it("fails on a latest.json naming an asset the release does not hold", () => {
		const release = healthyRelease(VERSION);
		release.assets = release.assets.filter((entry) => entry.name !== e.linux.deb);
		assert.match((check(healthyFeeds(VERSION), release) as { errors: string[] }).errors.join("\n"), /linux-x86_64-deb names "godspeed-linux-x64\.deb" which is not an asset/);
	});

	it("fails on a legacy template that points into the new release", () => {
		const legacy = templates();
		legacy["latest.yml"] = legacy["latest.yml"]!.replaceAll("../v0.5.51/", "");
		const feeds = healthyFeeds(VERSION);
		feeds["latest.yml"] = legacyFeed(legacy["latest.yml"], VERSION);
		assert.match((check(feeds, healthyRelease(VERSION), legacy) as { errors: string[] }).errors.join("\n"), /template for latest\.yml: "godspeed-windows-x64-setup\.exe" is not \.\.\/v0\.5\.51\/<file name>/);
	});

	it("fails when a legacy template is missing", () => {
		const legacy = templates();
		delete legacy["latest-linux.yml"];
		assert.match((check(healthyFeeds(VERSION), healthyRelease(VERSION), legacy) as { errors: string[] }).errors.join("\n"), /legacy-latest-linux\.yml is missing/);
	});
});

describe("release gate: workflow wiring", () => {
	const workflow = yaml.load(fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8"));
	const verify = workflow.jobs.verify;
	const readers = ["List every release, drafts included", "Download the four update feeds"];

	it("can see drafts after the feeds are up, only on real tag pushes", () => {
		assert.ok(verify);
		assert.deepEqual(verify.needs, ["quality", "feeds"]);
		assert.equal(workflow.jobs.feeds.needs, "package");
		assert.equal(verify.if, "github.event_name == 'push'");
		// GitHub's release-list API hides drafts from read-only tokens.
		assert.deepEqual(verify.permissions, { contents: "write" });
		assert.equal(verify.env?.GH_TOKEN, undefined);
	});

	it("exposes the token only to the two API-reading steps", () => {
		for (const step of verify.steps) {
			if (readers.includes(step.name)) assert.equal(step.env?.GH_TOKEN, "${{ github.token }}");
			else assert.equal(step.env?.GH_TOKEN, undefined, String(step.name ?? step.uses));
		}
		assert.equal(verify.steps.filter((step: any) => step.env?.GH_TOKEN).length, 2);
	});

	it("uses only GET requests, never release-changing commands", () => {
		const calls: string[] = verify.steps.flatMap((step: any) => (step.run ?? "").split("\n").filter((line: string) => /^\s*gh\s/.test(line)));
		assert.equal(calls.length, 2);
		for (const call of calls) {
			assert.match(call, /^\s*gh api /);
			assert.doesNotMatch(call, /(?:\s|^)(?:--(?:method|input|field|raw-field)(?:[=\s]|$)|-[XfF])/);
		}
	});

	it("checks out the tagged revision and runs select and verify", () => {
		const checkout = verify.steps.find((step: any) => step.uses?.startsWith("actions/checkout"));
		assert.deepEqual(checkout.with, { ref: "${{ github.sha }}", "persist-credentials": false });
		const final = verify.steps.find((step: any) => step.run?.includes("verify-release.ts verify"));
		assert.ok(verify.steps.find((step: any) => step.run?.includes("verify-release.ts select")) && final);
		assert.match(final.run, /--tag "\$GITHUB_REF_NAME"/);
		for (const step of verify.steps) assert.equal(step.run?.includes("create") ?? false, false, String(step.name));
	});

	it("downloads exactly the four update feeds from the selected draft", () => {
		const download = verify.steps.find((step: any) => step.name === "Download the four update feeds");
		for (const feed of ["latest.json", "latest-mac.yml", "latest.yml", "latest-linux.yml"]) assert.ok(download.run.includes(feed));
		assert.match(download.run, /releases\/assets\/\$id/);
	});

	it("never publishes, and uploads only on tag pushes", () => {
		const text = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
		assert.doesNotMatch(text, /draft:\s*false|--draft=false|gh release edit|updateRelease\(\{[^}]*draft/);
		for (const job of Object.values<any>(workflow.jobs)) {
			for (const step of job.steps ?? []) {
				if (/gh release upload/.test(step.run ?? "")) assert.match(step.if, /github\.event_name == 'push'/, String(step.name));
			}
		}
	});
});

describe("release gate: CLI (offline, repo config)", () => {
	// The CLI reads the real package version, so these fixtures follow it.
	const VERSION = (JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
	const TAG = `v${VERSION}`;
	const tsxImport = fileURLToPath(import.meta.resolve("tsx"));
	const run = (args: string[], cwd = repoRoot) =>
		spawnSync(process.execPath, ["--import", tsxImport, script, ...args], { cwd, encoding: "utf8", timeout: 60_000 });

	function workspace(tagForm: "v" | "bare" = "v", version = VERSION) {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "gs-release-gate-"));
		const release = healthyRelease(version, tagForm);
		fs.writeFileSync(path.join(root, "releases.json"), JSON.stringify([release]));
		fs.mkdirSync(path.join(root, "feeds"));
		for (const [name, content] of Object.entries(healthyFeeds(version))) fs.writeFileSync(path.join(root, "feeds", name), content);
		return { root, release };
	}
	const verifyIn = (root: string, tag = TAG, cwd = repoRoot) =>
		run(["verify", path.join(root, "releases.json"), path.join(root, "feeds"), "--tag", tag], cwd);

	it("select emits machine JSON for the workflow's download step", () => {
		const { root, release } = workspace();
		try {
			const result = run(["select", path.join(root, "releases.json"), "--tag", TAG]);
			assert.equal(result.status, 0, String(result.stderr));
			const report = JSON.parse(result.stdout) as { releaseId: number; matchedTagName: string; warnings: string[]; assets: Array<{ name: string }> };
			assert.equal(report.releaseId, release.id);
			assert.equal(report.matchedTagName, TAG);
			assert.deepEqual(report.warnings, []);
			assert.deepEqual(report.assets.map((entry) => entry.name), expectedAssets(VERSION).files);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("verify passes the complete draft and exits 0", () => {
		const { root } = workspace();
		try {
			const result = verifyIn(root);
			assert.equal(result.status, 0, String(result.stderr));
			assert.match(result.stdout, /10\/10 expected files present/);
			assert.ok(result.stdout.includes(`OK: draft for ${TAG} is complete`));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("verify fails a draft with a missing feed and a stale asset", () => {
		const { root } = workspace();
		try {
			const release = healthyRelease(VERSION);
			release.assets = release.assets.filter((entry) => entry.name !== "latest.json");
			release.assets.push(asset(9999, "godspeed-0.1.0-arm64-mac.zip"));
			fs.writeFileSync(path.join(root, "releases.json"), JSON.stringify([release]));
			fs.rmSync(path.join(root, "feeds", "latest.json"));
			const result = verifyIn(root);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /latest\.json: missing from the release/);
			assert.match(result.stderr, /latest\.json: not downloaded/);
			assert.match(result.stderr, /0\.1\.0-arm64-mac\.zip: unexpected asset/);
			assert.match(result.stderr, /do not publish/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("verify fails closed when the tag disagrees with package.json", () => {
		const { root } = workspace();
		try {
			const result = verifyIn(root, TAG === "v0.3.0" ? "v0.2.0" : "v0.3.0");
			assert.equal(result.status, 1);
			assert.match(result.stderr, /does not equal "v" \+ package\.json version/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("verify works after a package version bump without changing the tests", () => {
		const futureVersion = "12.3.4";
		const { root } = workspace("v", futureVersion);
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
			fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ ...pkg, version: futureVersion }));
			fs.mkdirSync(path.join(root, "crates", "shell", "release"), { recursive: true });
			fs.copyFileSync(path.join(repoRoot, "crates", "shell", "tauri.conf.json"), path.join(root, "crates", "shell", "tauri.conf.json"));
			for (const file of Object.values(LEGACY_TEMPLATES)) fs.copyFileSync(path.join(releaseDir, file), path.join(root, "crates", "shell", "release", file));
			const result = verifyIn(root, `v${futureVersion}`, root);
			assert.equal(result.status, 0, String(result.stderr));
			assert.ok(result.stdout.includes(`OK: draft for v${futureVersion} is complete`));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("select warns loudly for the unprefixed draft tag", () => {
		const { root } = workspace("bare");
		try {
			const result = run(["select", path.join(root, "releases.json"), "--tag", TAG]);
			assert.equal(result.status, 0, String(result.stdout));
			assert.ok(result.stderr.includes(`WARNING:`) && result.stderr.includes(`unprefixed tag "${VERSION}"`));
			assert.equal((JSON.parse(result.stdout) as { warnings: string[] }).warnings.length, 1);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
