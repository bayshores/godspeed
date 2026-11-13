/**
 * release-assets.mjs <mac|windows|linux> — give the bundler's outputs the names people download.
 *
 * The bundler names files godspeed_<version>_<arch>.<ext> and has no setting for that, so this
 * copies each one into dist/ under the fixed name the README links to, with its updater signature
 * beside it when latest.json points at it. On the Mac it also zips the stapled app for the
 * Electron hand-over, which updates from godspeed-<v>-arm64-mac.zip. dist/ is what the release
 * workflow uploads (the `.sig` files go into latest.json, scripts/release-feeds.mjs).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Bundler output (under bundle/) → download name, for one platform. A file with an `updater` key is
 * the one latest.json names under that platform key, so the bundler writes a `.sig` beside it; it
 * never signs the DMG.
 * @param {string} platform @param {string} version @returns {{ from: string, to: string, updater: string | null }[]}
 */
export function assetPlan(platform, version) {
	const plans = {
		mac: [
			[`dmg/godspeed_${version}_aarch64.dmg`, "godspeed-mac-apple-silicon.dmg", null],
			["macos/godspeed.app.tar.gz", "godspeed-mac-apple-silicon.app.tar.gz", "darwin-aarch64-app"],
		],
		windows: [[`nsis/godspeed_${version}_x64-setup.exe`, "godspeed-windows-x64-setup.exe", "windows-x86_64-nsis"]],
		linux: [
			[`appimage/godspeed_${version}_amd64.AppImage`, "godspeed-linux-x64.AppImage", "linux-x86_64-appimage"],
			[`deb/godspeed_${version}_amd64.deb`, "godspeed-linux-x64.deb", "linux-x86_64-deb"],
		],
	};
	return (plans[platform] ?? []).map(([from, to, updater]) => ({ from, to, updater }));
}

/** The zip of the stapled Mac app that Electron installs update from. @param {string} version */
export const handOverZip = (version) => `godspeed-${version}-arm64-mac.zip`;

/**
 * The one bundle folder that holds `relative`. A file in two folders means one is left from an older
 * build, and its name carries no version, so this refuses rather than guess which is fresh.
 * @param {string[]} bundles @param {string} relative @returns {string}
 */
export function findBundled(bundles, relative) {
	const found = bundles.map((dir) => path.join(dir, relative)).filter((candidate) => fs.existsSync(candidate));
	if (found.length === 0) throw new Error(`${relative} is missing from the bundle folder (${bundles.join(" or ")})`);
	if (found.length > 1) throw new Error(`${relative} is in more than one bundle folder (${found.join(" and ")}); delete the one from the older build`);
	return found[0];
}

function main(platform) {
	const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	const plan = assetPlan(platform, version);
	if (!plan.length) {
		console.error("usage: node scripts/release-assets.mjs <mac|windows|linux>");
		process.exit(1);
	}
	// `tauri build --target <triple>` writes under target/<triple>/, a plain build under target/.
	const triple = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
	const bundles = [path.join(ROOT, "target", triple, "release", "bundle"), path.join(ROOT, "target", "release", "bundle")];

	const out = path.join(ROOT, "dist");
	fs.mkdirSync(out, { recursive: true });
	for (const { from, to, updater } of plan) {
		for (const suffix of updater ? ["", ".sig"] : [""]) {
			fs.copyFileSync(findBundled(bundles, from + suffix), path.join(out, to + suffix));
			console.log(`[release-assets] ${to}${suffix}`);
		}
	}
	if (platform === "mac") {
		const zip = path.join(out, handOverZip(version));
		fs.rmSync(zip, { force: true });
		execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", findBundled(bundles, "macos/godspeed.app"), zip]);
		console.log(`[release-assets] ${path.basename(zip)}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		main(process.argv[2]);
	} catch (err) {
		console.error(`[release-assets] ${err.message}`);
		process.exit(1);
	}
}
