/**
 * release-assets.mjs <mac|windows|linux> — give the bundler's outputs the names people download.
 *
 * The bundler names files godspeed_<version>_<arch>.<ext> and has no setting for that, so this
 * copies each one into dist/ under the fixed name the README links to, with its updater signature
 * beside it. On the Mac it also zips the stapled app for the Electron hand-over, which updates
 * from godspeed-<v>-arm64-mac.zip. dist/ is what the release workflow uploads.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Bundler output (under bundle/) → download name, for one platform. Each has a `.sig` beside it.
 * @param {string} platform @param {string} version @returns {{ from: string, to: string }[]}
 */
export function assetPlan(platform, version) {
	const plans = {
		mac: [
			[`dmg/godspeed_${version}_aarch64.dmg`, "godspeed-mac-apple-silicon.dmg"],
			["macos/godspeed.app.tar.gz", "godspeed-mac-apple-silicon.app.tar.gz"],
		],
		windows: [[`nsis/godspeed_${version}_x64-setup.exe`, "godspeed-windows-x64-setup.exe"]],
		linux: [
			[`appimage/godspeed_${version}_amd64.AppImage`, "godspeed-linux-x64.AppImage"],
			[`deb/godspeed_${version}_amd64.deb`, "godspeed-linux-x64.deb"],
		],
	};
	return (plans[platform] ?? []).map(([from, to]) => ({ from, to }));
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
	const find = (relative) => {
		const file = bundles.map((dir) => path.join(dir, relative)).find((candidate) => fs.existsSync(candidate));
		if (!file) {
			console.error(`[release-assets] ${relative} is missing from the bundle folder (${bundles.join(" or ")})`);
			process.exit(1);
		}
		return file;
	};

	const out = path.join(ROOT, "dist");
	fs.mkdirSync(out, { recursive: true });
	for (const { from, to } of plan) {
		for (const suffix of ["", ".sig"]) {
			fs.copyFileSync(find(from + suffix), path.join(out, to + suffix));
			console.log(`[release-assets] ${to}${suffix}`);
		}
	}
	if (platform === "mac") {
		const zip = path.join(out, `godspeed-${version}-arm64-mac.zip`);
		fs.rmSync(zip, { force: true });
		execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", find("macos/godspeed.app"), zip]);
		console.log(`[release-assets] ${path.basename(zip)}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2]);
