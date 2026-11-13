/**
 * release-feeds.mjs — write the update feeds a release publishes.
 *
 *   node scripts/release-feeds.mjs <dir> --mac-staging <0-100>
 *     <dir> holds every download of the release and the updater signatures beside them
 *     (scripts/release-assets.mjs's dist/ from all three systems). Writes into <dir>:
 *       latest.json       the Tauri updater's feed, one entry per platform key, signatures inlined
 *       latest-mac.yml    electron-updater's feed for Electron Macs: the zip of the new app
 *       latest.yml        Electron on Windows and Linux: the last Electron release, from the
 *       latest-linux.yml  templates in crates/shell/release/, plus `newApp: <version>`
 *   node scripts/release-feeds.mjs <dir> --mac-staging <0-100> --mac-only
 *     Rewrites only <dir>/latest-mac.yml with a new share, keeping everything else in it.
 *
 * electron-updater offers latest-mac.yml to installs whose random id falls under
 * `stagingPercentage`; 100 writes no field, which means everyone.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { assetPlan, handOverZip } from "./release-assets.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOWNLOAD = "https://github.com/bayshores/godspeed/releases/download";
/** Darwin 23 is macOS 14; electron-updater compares this with `os.release()`. */
const MAC_MINIMUM_DARWIN = "23.0.0";
const LEGACY = { "latest.yml": "legacy-latest.yml", "latest-linux.yml": "legacy-latest-linux.yml" };

/** The base64 sha512 electron-updater checks a download against. @param {string} file */
function sha512(file) {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha512");
		fs.createReadStream(file)
			.on("data", (chunk) => hash.update(chunk))
			.on("end", () => resolve(hash.digest("base64")))
			.on("error", reject);
	});
}

/** @param {string} value @returns {number} */
export function stagingShare(value) {
	const share = Number(value);
	if (!/^\d+$/.test(String(value)) || share > 100) throw new Error(`--mac-staging must be a whole number from 0 to 100, got ${JSON.stringify(value)}`);
	return share;
}

/**
 * latest.json for Tauri installs. `signatures` maps each platform key to its `.sig` file's text.
 * @param {string} version @param {string} pubDate @param {Record<string, string>} signatures
 */
export function tauriFeed(version, pubDate, signatures) {
	const platforms = {};
	for (const platform of ["mac", "windows", "linux"]) {
		for (const { to, updater } of assetPlan(platform, version)) {
			if (updater) platforms[updater] = { signature: signatures[updater], url: `${DOWNLOAD}/v${version}/${to}` };
		}
	}
	return `${JSON.stringify({ version, pub_date: pubDate, platforms }, null, 2)}\n`;
}

/**
 * latest-mac.yml in electron-builder's shape: the zip first, the legacy path and sha512 backed by it.
 * @param {{ version: string, zip: {url: string, sha512: string, size: number}, dmg: {url: string, sha512: string, size: number}, releaseDate: string, staging: number }} feed
 */
export function macFeed({ version, zip, dmg, releaseDate, staging }) {
	const entry = (file) => `  - url: ${file.url}\n    sha512: ${file.sha512}\n    size: ${file.size}\n`;
	return (
		`version: ${version}\nfiles:\n${entry(zip)}${entry(dmg)}` +
		`path: ${zip.url}\nsha512: ${zip.sha512}\nreleaseDate: '${releaseDate}'\n` +
		`minimumSystemVersion: ${MAC_MINIMUM_DARWIN}\n` +
		(staging < 100 ? `stagingPercentage: ${staging}\n` : "")
	);
}

/** The same latest-mac.yml with a new share. @param {string} text @param {number} staging */
export function restageMacFeed(text, staging) {
	const info = /** @type {any} */ (yaml.load(text));
	const [zip, dmg] = info?.files ?? [];
	if (!zip || !dmg || typeof info.releaseDate !== "string") throw new Error("latest-mac.yml is not a feed this script wrote");
	return macFeed({ version: String(info.version), zip, dmg, releaseDate: info.releaseDate, staging });
}

/** A legacy feed: the template unchanged, plus the new version. @param {string} template @param {string} version */
export const legacyFeed = (template, version) => `${template}newApp: ${version}\n`;

async function main(argv) {
	const dir = argv[0];
	const shareAt = argv.indexOf("--mac-staging");
	if (!dir || dir.startsWith("--") || shareAt < 0) throw new Error("usage: node scripts/release-feeds.mjs <dir> --mac-staging <0-100> [--mac-only]");
	const staging = stagingShare(argv[shareAt + 1]);
	const write = (name, text) => {
		fs.writeFileSync(path.join(dir, name), text);
		console.log(`[release-feeds] ${name}`);
	};

	if (argv.includes("--mac-only")) {
		write("latest-mac.yml", restageMacFeed(fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8"), staging));
		return;
	}

	const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	const now = new Date().toISOString();
	const file = (name) => {
		const full = path.join(dir, name);
		if (!fs.existsSync(full)) throw new Error(`${name} is missing from ${dir}`);
		return full;
	};

	const signatures = {};
	for (const platform of ["mac", "windows", "linux"]) {
		for (const { to, updater } of assetPlan(platform, version)) {
			if (updater) signatures[updater] = fs.readFileSync(file(`${to}.sig`), "utf8").trim();
		}
	}
	write("latest.json", tauriFeed(version, now, signatures));

	const described = async (name) => ({ url: name, sha512: await sha512(file(name)), size: fs.statSync(file(name)).size });
	const dmg = assetPlan("mac", version).find((entry) => !entry.updater).to;
	write("latest-mac.yml", macFeed({ version, zip: await described(handOverZip(version)), dmg: await described(dmg), releaseDate: now, staging }));

	for (const [name, template] of Object.entries(LEGACY)) {
		write(name, legacyFeed(fs.readFileSync(path.join(ROOT, "crates", "shell", "release", template), "utf8"), version));
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(`[release-feeds] ${err.message}`);
		process.exit(1);
	});
}
