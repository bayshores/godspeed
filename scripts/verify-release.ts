/**
 * verify-release.ts — the final desktop-release gate.
 *
 * Runs in the release workflow's last job, after the four packaging jobs and the feeds job have
 * uploaded to the tag's one draft GitHub Release, and fails the workflow unless that draft holds
 * exactly what people and both updaters need. The workflow never publishes; this script only
 * reads (the release list and the four feeds, which the workflow fetches with GET-only calls; the
 * token needs contents: write because GitHub hides drafts from read-only tokens).
 *
 * The twelve assets (names from scripts/release-assets.mjs and scripts/release-feeds.mjs, kept
 * separately here so a rename in either fails this gate instead of passing it):
 *   godspeed-mac-apple-silicon.dmg, godspeed-mac-intel.dmg, godspeed-windows-x64-setup.exe,
 *   godspeed-linux-x64.AppImage, godspeed-linux-x64.deb
 *                                      the downloads the README links to (no version in the name)
 *   godspeed-mac-apple-silicon.app.tar.gz, godspeed-mac-intel.app.tar.gz
 *                                      the Tauri updater's Mac archives
 *   latest.json                        the Tauri updater's feed
 *   godspeed-<v>-arm64-mac.zip, latest-mac.yml   the hand-over for Electron Macs
 *   latest.yml, latest-linux.yml       Electron on Windows and Linux: the last Electron release
 *                                      (crates/shell/release/legacy-*.yml) plus `newApp: <v>`
 *
 * Draft selection fails closed and matches the way the draft job does: tag_name equals the tag
 * ("v0.6.0") or the bare version ("0.6.0"). Zero matches, two or more, or a published match fail.
 *
 * CLI (cwd = the checked-out tag revision):
 *   tsx scripts/verify-release.ts select <releases.json> --tag <tag>
 *     → one JSON object on stdout: {releaseId, matchedTagName, warnings, assets:[{id,name,size,state}]}.
 *   tsx scripts/verify-release.ts verify <releases.json> <feeds-dir> --tag <tag>
 *     → the full gate; a report on stdout; exit 0 only when everything passes.
 *
 * It fails on any of: the tag is not "v" + package.json's version; crates/shell/tauri.conf.json
 * drifting from the shape the names come from, or an empty updater `pubkey` (the bundler signs
 * without reading it, and an app built with none can never verify an update); draft selection
 * problems; assets missing, extra, duplicated, empty or not "uploaded"; a feed that does not
 * parse, carries the wrong version, points at anything but this release's own assets (the legacy
 * feeds: anything but the last Electron release), disagrees with an asset's size, or has a
 * signature that is not one the bundler wrote for this version.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load(source: string): unknown };

export type ReleaseAsset = { id: number; name: string; size: number; state: string };
export type ReleaseRecord = { id: number; tag_name: string; draft: boolean; assets: ReleaseAsset[] };

type Issues = string[];
type Verdict = { ok: true } | { ok: false; errors: Issues };
export type DraftSelection = { ok: true; release: ReleaseRecord; warnings: string[] } | { ok: false; errors: Issues };

/** The expected assets for one version. */
export type ExpectedAssets = {
	version: string;
	mac: { dmg: string; archive: string; zip: string; feed: string };
	macIntel: { dmg: string; archive: string };
	win: { exe: string; feed: string };
	linux: { appImage: string; deb: string; feed: string };
	tauriFeed: string;
	/** Every asset name the draft must hold, and no others. */
	files: string[];
};

/** The two Electron feeds and their committed templates. */
type LegacyTemplates = Record<string, string>;
export const LEGACY_TEMPLATES = { "latest.yml": "legacy-latest.yml", "latest-linux.yml": "legacy-latest-linux.yml" };

const REPO = "bayshores/godspeed";
const TAURI_CONFIG = "crates/shell/tauri.conf.json";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function checkVersion(version: unknown): { ok: true; version: string } | { ok: false; errors: Issues } {
	if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
		return { ok: false, errors: [`package.json version must be a plain semver string, got ${JSON.stringify(version)}`] };
	}
	return { ok: true, version };
}

export function expectedAssets(version: string): ExpectedAssets {
	const mac = {
		dmg: "godspeed-mac-apple-silicon.dmg",
		archive: "godspeed-mac-apple-silicon.app.tar.gz",
		zip: `godspeed-${version}-arm64-mac.zip`,
		feed: "latest-mac.yml",
	};
	const macIntel = { dmg: "godspeed-mac-intel.dmg", archive: "godspeed-mac-intel.app.tar.gz" };
	const win = { exe: "godspeed-windows-x64-setup.exe", feed: "latest.yml" };
	const linux = { appImage: "godspeed-linux-x64.AppImage", deb: "godspeed-linux-x64.deb", feed: "latest-linux.yml" };
	const tauriFeed = "latest.json";
	return {
		version,
		mac,
		macIntel,
		win,
		linux,
		tauriFeed,
		files: [mac.dmg, macIntel.dmg, win.exe, linux.appImage, linux.deb, mac.archive, macIntel.archive, tauriFeed, mac.zip, mac.feed, win.feed, linux.feed],
	};
}

/** The asset latest.json must name under each platform key. */
function tauriPlatforms(expected: ExpectedAssets): Record<string, string> {
	return {
		"darwin-aarch64-app": expected.mac.archive,
		"darwin-x86_64-app": expected.macIntel.archive,
		"windows-x86_64-nsis": expected.win.exe,
		"linux-x86_64-appimage": expected.linux.appImage,
		"linux-x86_64-deb": expected.linux.deb,
	};
}

// --- Release list -------------------------------------------------------------------------------

/** `gh api --paginate --slurp` gives an array of pages; a hand-made single page is a plain array. */
export function normalizeReleasePages(input: unknown): { ok: true; releases: unknown[] } | { ok: false; errors: Issues } {
	if (!Array.isArray(input)) return { ok: false, errors: ["release list is not a JSON array"] };
	const pages = input.length > 0 && Array.isArray(input[0]) ? input : [input];
	return { ok: true, releases: pages.flat() };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReleases(entries: unknown[]): { ok: true; releases: ReleaseRecord[] } | { ok: false; errors: Issues } {
	const errors: Issues = [];
	const releases: ReleaseRecord[] = [];
	entries.forEach((entry, index) => {
		const label = `releases[${index}]`;
		if (!isPlainObject(entry)) {
			errors.push(`${label}: not an object`);
			return;
		}
		const { id, tag_name: tagName, draft, assets } = entry;
		if (typeof id !== "number" || !Number.isFinite(id)) errors.push(`${label}: id is not a number`);
		if (typeof tagName !== "string" || tagName === "") errors.push(`${label}: tag_name is not a non-empty string`);
		if (typeof draft !== "boolean") errors.push(`${label}: draft is not a boolean`);
		const parsedAssets: ReleaseAsset[] = [];
		if (!Array.isArray(assets)) {
			errors.push(`${label}: assets is not an array`);
		} else {
			assets.forEach((asset, assetIndex) => {
				const assetLabel = `${label}.assets[${assetIndex}]`;
				if (!isPlainObject(asset)) {
					errors.push(`${assetLabel}: not an object`);
					return;
				}
				const { id: assetId, name, size, state } = asset;
				const assetOk =
					typeof assetId === "number" && Number.isFinite(assetId) &&
					typeof name === "string" && name !== "" &&
					typeof size === "number" && Number.isFinite(size) &&
					typeof state === "string" && state !== "";
				if (!assetOk) {
					errors.push(`${assetLabel}: needs numeric id, non-empty string name, numeric size, non-empty string state`);
					return;
				}
				parsedAssets.push({ id: assetId, name, size, state });
			});
		}
		if (typeof id === "number" && typeof tagName === "string" && tagName !== "" && typeof draft === "boolean") {
			releases.push({ id, tag_name: tagName, draft, assets: parsedAssets });
		}
	});
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, releases };
}

export function selectDraft(releases: ReleaseRecord[], tag: string, version: string): DraftSelection {
	const matches = releases.filter((release) => release.tag_name === tag || release.tag_name === version);
	if (matches.length === 0) {
		return { ok: false, errors: [`no release matches "${tag}" or "${version}"; the draft job should have prepared exactly one draft`] };
	}
	if (matches.length > 1) {
		const list = matches.map((release) => `#${release.id} (${release.tag_name}, ${release.draft ? "draft" : "published"})`).join(", ");
		return { ok: false, errors: [`${matches.length} releases match ${tag}: ${list}; resolve to exactly one before publishing`] };
	}
	const [match] = matches;
	if (!match) return { ok: false, errors: ["internal: empty match"] };
	if (!match.draft) {
		return { ok: false, errors: [`release #${match.id} (${match.tag_name}) is already published; the workflow never modifies a published release`] };
	}
	const warnings: string[] = [];
	if (match.tag_name !== tag) {
		warnings.push(
			`draft #${match.id} carries the unprefixed tag "${match.tag_name}" instead of "${tag}": the draft job matches both spellings, ` +
			`but gh uploads by tag, so a later run could make a SECOND draft under "${tag}"; rename the release to "${tag}" before publishing`,
		);
	}
	return { ok: true, release: match, warnings };
}

// --- Packaging config drift guard ---------------------------------------------------------------

/** The names above come from this config shape; drift means they must be checked again. */
export function verifyConfigAssumptions(config: unknown, pkg: unknown): Verdict {
	const errors: Issues = [];
	const bad = (message: string) => errors.push(message);
	if (!isPlainObject(pkg) || typeof pkg.version !== "string") bad("package.json has no string version");
	if (!isPlainObject(pkg) || pkg.name !== "godspeed") bad('package.json name is no longer "godspeed"');
	if (!isPlainObject(config)) return { ok: false, errors: [`${TAURI_CONFIG} is not a JSON object`, ...errors] };
	const expect = (label: string, actual: unknown, wanted: unknown) => {
		if (!isDeepStrictEqual(actual, wanted)) bad(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`);
	};
	const bundle = isPlainObject(config.bundle) ? config.bundle : {};
	const macOS = isPlainObject(bundle.macOS) ? bundle.macOS : {};
	const plugins = isPlainObject(config.plugins) ? config.plugins : {};
	const updater = isPlainObject(plugins.updater) ? plugins.updater : {};
	expect("productName", config.productName, "godspeed");
	expect("mainBinaryName", config.mainBinaryName, "godspeed");
	expect("identifier", config.identifier, "com.bayshores.godspeed");
	expect("version", config.version, "../../package.json");
	expect("bundle.targets", bundle.targets, ["app", "dmg", "nsis", "appimage", "deb"]);
	expect("bundle.createUpdaterArtifacts", bundle.createUpdaterArtifacts, true);
	expect("bundle.macOS.minimumSystemVersion", macOS.minimumSystemVersion, "14.0");
	expect("plugins.updater.endpoints", updater.endpoints, [`https://github.com/${REPO}/releases/latest/download/latest.json`]);
	if (typeof updater.pubkey !== "string" || updater.pubkey.trim() === "") {
		bad("plugins.updater.pubkey is empty, so this build could never verify an update");
	}
	if (errors.length > 0) {
		errors.push(`the packaging config drifted; check the expected assets in scripts/verify-release.ts against the new bundler output`);
		return { ok: false, errors };
	}
	return { ok: true };
}

// --- Assets -------------------------------------------------------------------------------------

export function verifyAssets(release: ReleaseRecord, expected: ExpectedAssets): Verdict {
	const errors: Issues = [];
	const seen = new Set<string>();
	for (const asset of release.assets) {
		if (seen.has(asset.name)) errors.push(`duplicate asset name on the release: ${asset.name}`);
		seen.add(asset.name);
		if (asset.state !== "uploaded") errors.push(`${asset.name}: state is "${asset.state}", not "uploaded"`);
		if (!(asset.size > 0)) errors.push(`${asset.name}: zero-size asset (size=${asset.size})`);
		if (!expected.files.includes(asset.name)) errors.push(`${asset.name}: unexpected asset, not in the expected set (stale name from an older run?)`);
	}
	for (const name of expected.files) {
		if (!seen.has(name)) errors.push(`${name}: missing from the release`);
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true };
}

// --- Feeds --------------------------------------------------------------------------------------

/** A feed reference must be a bare file name: no folders, traversal, scheme, query or fragment. */
export function isPlainAssetName(url: unknown): url is string {
	return typeof url === "string" && url !== "" && url !== "." && url !== ".." &&
		!url.includes("/") && !url.includes("\\") && !url.includes(":") && !url.includes("?") && !url.includes("#") && !url.startsWith("~");
}

const SHA512_BASE64 = /^[A-Za-z0-9+/]{80,}={0,2}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MAC_FEED_FIELDS = ["version", "files", "path", "sha512", "releaseDate", "minimumSystemVersion", "stagingPercentage"];

function loadYaml(file: string, content: string, errors: Issues): Record<string, unknown> | null {
	let info: unknown;
	try {
		info = yaml.load(content);
	} catch (error) {
		errors.push(`${file}: does not parse as YAML (${String(error)})`);
		return null;
	}
	if (!isPlainObject(info)) {
		errors.push(`${file}: top level is not a mapping`);
		return null;
	}
	return info;
}

/** latest-mac.yml: the zip first and backing the legacy fields, then the DMG, at the uploaded sizes. */
function verifyMacFeed(content: string, release: ReleaseRecord, expected: ExpectedAssets, errors: Issues) {
	const file = expected.mac.feed;
	const info = loadYaml(file, content, errors);
	if (!info) return;
	if (info.version !== expected.version) errors.push(`${file}: version is ${JSON.stringify(info.version)}, expected "${expected.version}"`);
	for (const key of Object.keys(info)) if (!MAC_FEED_FIELDS.includes(key)) errors.push(`${file}: unexpected field "${key}"`);
	if (info.minimumSystemVersion !== "23.0.0") {
		errors.push(`${file}: minimumSystemVersion is ${JSON.stringify(info.minimumSystemVersion)}, expected "23.0.0" (Darwin for macOS 14)`);
	}
	const staging = info.stagingPercentage;
	if (staging !== undefined && !(Number.isInteger(staging) && (staging as number) >= 0 && (staging as number) <= 99)) {
		errors.push(`${file}: stagingPercentage is ${JSON.stringify(staging)}, expected a whole number from 0 to 99 (or no field for everyone)`);
	}
	if (typeof info.releaseDate !== "string" || !RFC3339.test(info.releaseDate)) errors.push(`${file}: releaseDate is not an ISO time`);
	if (!Array.isArray(info.files)) {
		errors.push(`${file}: no files[] entries`);
		return;
	}
	const sizes = new Map(release.assets.map((asset) => [asset.name, asset.size]));
	const urls: unknown[] = [];
	info.files.forEach((entry, index) => {
		if (!isPlainObject(entry)) {
			errors.push(`${file}: files[${index}] is not a mapping`);
			return;
		}
		const { url, sha512, size } = entry;
		urls.push(url);
		if (!isPlainAssetName(url)) {
			errors.push(`${file}: files[${index}].url is not a bare asset name (${JSON.stringify(url)})`);
			return;
		}
		if (typeof sha512 !== "string" || !SHA512_BASE64.test(sha512)) errors.push(`${file}: files[${index}] (${url}): sha512 is not a base64 digest`);
		if (!sizes.has(url)) errors.push(`${file}: references "${url}" which is not an asset of release #${release.id}`);
		else if (size !== sizes.get(url)) errors.push(`${file}: "${url}" size ${JSON.stringify(size)} ≠ release asset size ${sizes.get(url)}`);
	});
	if (!isDeepStrictEqual(urls, [expected.mac.zip, expected.mac.dmg])) {
		errors.push(`${file}: files are [${urls.join(", ")}] but must be exactly [${expected.mac.zip}, ${expected.mac.dmg}], the zip first`);
	}
	const first = info.files[0];
	if (isPlainObject(first)) {
		if (info.path !== first.url) errors.push(`${file}: top-level path is ${JSON.stringify(info.path)}, must be "${String(first.url)}"`);
		if (info.sha512 !== first.sha512) errors.push(`${file}: top-level sha512 does not match files[0]`);
	}
}

/** The template a legacy feed was made from must point only into the last Electron release. */
function verifyTemplate(name: string, template: Record<string, unknown>, errors: Issues) {
	const into = `../v${String(template.version)}/`;
	const refs = [template.path, ...(Array.isArray(template.files) ? template.files.map((entry) => (isPlainObject(entry) ? entry.url : entry)) : [])];
	for (const ref of refs) {
		if (typeof ref !== "string" || !ref.startsWith(into) || !isPlainAssetName(ref.slice(into.length))) {
			errors.push(`${name}: ${JSON.stringify(ref)} is not ${into}<file name>`);
		}
	}
}

/** latest.yml and latest-linux.yml: the committed template plus `newApp: <version>`, nothing else. */
function verifyLegacyFeed(file: string, content: string, templateText: string | undefined, expected: ExpectedAssets, errors: Issues) {
	if (templateText == null) {
		errors.push(`${file}: the template crates/shell/release/${LEGACY_TEMPLATES[file as keyof typeof LEGACY_TEMPLATES]} is missing`);
		return;
	}
	const template = loadYaml(`template for ${file}`, templateText, errors);
	const info = loadYaml(file, content, errors);
	if (!template || !info) return;
	verifyTemplate(`template for ${file}`, template, errors);
	if (!isDeepStrictEqual(info, { ...template, newApp: expected.version })) {
		errors.push(`${file}: is not its committed template plus "newApp: ${expected.version}"`);
	}
}

/** A `.sig` file's text: base64 of minisign's signature, whose trusted comment names the version. */
function isBundlerSignature(signature: unknown, version: string): boolean {
	if (typeof signature !== "string" || signature === "") return false;
	const text = Buffer.from(signature, "base64").toString("utf8");
	return text.startsWith("untrusted comment:") && new RegExp(`^trusted comment: .*\\bversion:${version.replaceAll(".", "\\.")}$`, "m").test(text);
}

/** latest.json: the version, exactly the five platform keys, each this release's own asset. */
function verifyTauriFeed(content: string, release: ReleaseRecord, expected: ExpectedAssets, errors: Issues) {
	const file = expected.tauriFeed;
	let info: unknown;
	try {
		info = JSON.parse(content);
	} catch (error) {
		errors.push(`${file}: does not parse as JSON (${String(error)})`);
		return;
	}
	if (!isPlainObject(info)) {
		errors.push(`${file}: top level is not an object`);
		return;
	}
	if (info.version !== expected.version) errors.push(`${file}: version is ${JSON.stringify(info.version)}, expected "${expected.version}"`);
	if (typeof info.pub_date !== "string" || !RFC3339.test(info.pub_date)) errors.push(`${file}: pub_date is not an RFC 3339 time`);
	for (const key of Object.keys(info)) if (!["version", "pub_date", "platforms"].includes(key)) errors.push(`${file}: unexpected field "${key}"`);
	const platforms = isPlainObject(info.platforms) ? info.platforms : {};
	const wanted = tauriPlatforms(expected);
	const keys = Object.keys(platforms).sort();
	if (!isDeepStrictEqual(keys, Object.keys(wanted).sort())) {
		errors.push(`${file}: platforms are [${keys.join(", ")}] but must be exactly [${Object.keys(wanted).join(", ")}]`);
	}
	const names = new Set(release.assets.map((asset) => asset.name));
	for (const [key, asset] of Object.entries(wanted)) {
		const entry = platforms[key];
		if (!isPlainObject(entry)) continue;
		const url = `https://github.com/${REPO}/releases/download/v${expected.version}/${asset}`;
		if (entry.url !== url) errors.push(`${file}: ${key}.url is ${JSON.stringify(entry.url)}, expected "${url}"`);
		if (!names.has(asset)) errors.push(`${file}: ${key} names "${asset}" which is not an asset of release #${release.id}`);
		if (!isBundlerSignature(entry.signature, expected.version)) {
			errors.push(`${file}: ${key}.signature is not a .sig the bundler wrote for version ${expected.version}`);
		}
	}
}

export function verifyFeeds(
	feeds: Record<string, string>,
	templates: LegacyTemplates,
	release: ReleaseRecord,
	expected: ExpectedAssets,
): Verdict {
	const errors: Issues = [];
	const names = [expected.tauriFeed, expected.mac.feed, expected.win.feed, expected.linux.feed];
	for (const name of names) {
		const content = feeds[name];
		if (content == null || content === "") {
			errors.push(`${name}: not downloaded (or empty), cannot verify the update feed`);
		} else if (name === expected.tauriFeed) {
			verifyTauriFeed(content, release, expected, errors);
		} else if (name === expected.mac.feed) {
			verifyMacFeed(content, release, expected, errors);
		} else {
			verifyLegacyFeed(name, content, templates[name], expected, errors);
		}
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true };
}

// --- CLI ----------------------------------------------------------------------------------------

function usage(): string {
	return [
		"usage:",
		"  verify-release.ts select <releases.json> --tag <tag>",
		"  verify-release.ts verify <releases.json> <feeds-dir> --tag <tag>",
	].join("\n");
}

function readJson(file: string): { ok: true; value: unknown } | { ok: false; error: string } {
	let source: string;
	try {
		source = fs.readFileSync(file, "utf8");
	} catch (error) {
		return { ok: false, error: `cannot read ${file}: ${String(error)}` };
	}
	try {
		return { ok: true, value: JSON.parse(source) };
	} catch (error) {
		return { ok: false, error: `${file} is not valid JSON: ${String(error)}` };
	}
}

function loadReleases(file: string): { ok: true; releases: ReleaseRecord[] } | { ok: false; errors: Issues } {
	const json = readJson(file);
	if (!json.ok) return { ok: false, errors: [json.error] };
	const normalized = normalizeReleasePages(json.value);
	if (!normalized.ok) return normalized;
	return parseReleases(normalized.releases);
}

/** The cwd's package.json and Tauri config; the workflow checks out the tagged revision first. */
function loadRepoConfig(): { ok: true; pkg: unknown; config: unknown } | { ok: false; errors: Issues } {
	const pkg = readJson("package.json");
	if (!pkg.ok) return { ok: false, errors: [pkg.error] };
	const config = readJson(TAURI_CONFIG);
	if (!config.ok) return { ok: false, errors: [config.error] };
	return { ok: true, pkg: pkg.value, config: config.value };
}

/** Reads each file in `names` from `dir`; a missing one is left out for the checks to name. */
function readFiles(dir: string, names: string[]): Record<string, string> {
	const files: Record<string, string> = {};
	for (const name of names) {
		try {
			files[name] = fs.readFileSync(path.join(dir, name), "utf8");
		} catch {
			// verifyFeeds reports it by name.
		}
	}
	return files;
}

function fail(errors: Issues): number {
	for (const error of errors) console.error(`ERROR: ${error}`);
	console.error("FAILED: the draft release gate found problems; do not publish. Fix and run the release workflow again.");
	return 1;
}

function parseArgs(argv: string[]): { ok: true; command: string; positional: string[]; tag?: string } | { ok: false; errors: Issues } {
	const positional: string[] = [];
	let tag: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--tag") {
			tag = argv[++i];
			if (tag == null || tag === "") return { ok: false, errors: ["--tag needs a value"] };
		} else {
			positional.push(arg);
		}
	}
	const [command] = positional;
	if (command !== "select" && command !== "verify") return { ok: false, errors: [usage()] };
	return { ok: true, command, positional: positional.slice(1), tag };
}

/** Tag and version agree, and the release list loads; shared by both commands. */
function startGate(argv: string[]):
	| { ok: true; tag: string; version: string; releases: ReleaseRecord[]; config: unknown; pkg: unknown; positional: string[] }
	| { ok: false; errors: Issues } {
	const parsed = parseArgs(argv);
	if (!parsed.ok) return parsed;
	const releasesFile = parsed.positional[0];
	if (parsed.tag == null) return { ok: false, errors: ["--tag is required (the pushed tag, e.g. v0.6.0)"] };
	if (releasesFile == null) return { ok: false, errors: [usage()] };
	const repo = loadRepoConfig();
	if (!repo.ok) return repo;
	const versioned = checkVersion(isPlainObject(repo.pkg) ? repo.pkg.version : undefined);
	if (!versioned.ok) return versioned;
	const expectedTag = `v${versioned.version}`;
	if (parsed.tag !== expectedTag) {
		return { ok: false, errors: [`tag ${parsed.tag} does not equal "v" + package.json version ("${expectedTag}")`] };
	}
	const releases = loadReleases(releasesFile);
	if (!releases.ok) return releases;
	return { ok: true, tag: parsed.tag, version: versioned.version, releases: releases.releases, config: repo.config, pkg: repo.pkg, positional: parsed.positional };
}

function main(argv: string[]): number {
	const start = startGate(argv);
	if (!start.ok) return fail(start.errors);
	const expected = expectedAssets(start.version);

	if (argv[0] === "select") {
		const selection = selectDraft(start.releases, start.tag, start.version);
		if (!selection.ok) return fail(selection.errors);
		for (const warning of selection.warnings) console.error(`WARNING: ${warning}`);
		const report = {
			releaseId: selection.release.id,
			tag: start.tag,
			matchedTagName: selection.release.tag_name,
			warnings: selection.warnings,
			assets: selection.release.assets.map((asset) => ({ id: asset.id, name: asset.name, size: asset.size, state: asset.state })),
		};
		process.stdout.write(`${JSON.stringify(report, null, "\t")}\n`);
		return 0;
	}

	const feedsDir = start.positional[1];
	if (feedsDir == null) return fail([usage()]);
	const errors: Issues = [];
	const assumptions = verifyConfigAssumptions(start.config, start.pkg);
	if (!assumptions.ok) errors.push(...assumptions.errors);
	const selection = selectDraft(start.releases, start.tag, start.version);
	if (!selection.ok) return fail([...errors, ...selection.errors]);
	console.log(`draft release #${selection.release.id}, tag "${selection.release.tag_name}"`);
	for (const warning of selection.warnings) console.log(`WARNING: ${warning}`);
	const assets = verifyAssets(selection.release, expected);
	if (!assets.ok) errors.push(...assets.errors);
	const feedNames = [expected.tauriFeed, expected.mac.feed, expected.win.feed, expected.linux.feed];
	const feeds = readFiles(feedsDir, feedNames);
	const templateTexts = readFiles(path.join("crates", "shell", "release"), Object.values(LEGACY_TEMPLATES));
	const templates: LegacyTemplates = {};
	for (const [feed, template] of Object.entries(LEGACY_TEMPLATES)) if (templateTexts[template] != null) templates[feed] = templateTexts[template];
	const checked = verifyFeeds(feeds, templates, selection.release, expected);
	if (!checked.ok) errors.push(...checked.errors);
	if (errors.length > 0) return fail(errors);
	console.log(`assets: ${expected.files.length}/${expected.files.length} expected files present, non-zero size, and "uploaded"`);
	console.log(`feeds: ${feedNames.join(", ")} parse, carry version ${start.version}, and point only at the assets they should`);
	console.log(`OK: draft for ${start.tag} is complete and consistent, ready for the owner to review and publish.`);
	return 0;
}

const invokedAsCli = process.argv[1] != null && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsCli) process.exitCode = main(process.argv.slice(2));
