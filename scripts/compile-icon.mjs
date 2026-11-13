/**
 * compile-icon.mjs — compile the Mac app icon (crates/shell/icons/icon.icon) into .stage/Assets.car.
 *
 * Needs actool from Xcode 26 or newer. The Mac builds run this before `tauri build`; the Mac
 * bundle config ships the file. The bundler's own actool call crashes on GitHub's macOS 26
 * runners, and this one does not.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-icon-"));
const out = path.join(work, "out");

// actool names the icon after its folder, and the bundler reads that name from the compiled file.
fs.cpSync(path.join(ROOT, "crates", "shell", "icons", "icon.icon"), path.join(work, "Icon.icon"), { recursive: true });
fs.mkdirSync(out);
execFileSync(
	"actool",
	[
		path.join(work, "Icon.icon"),
		"--compile",
		out,
		"--output-format",
		"human-readable-text",
		"--output-partial-info-plist",
		path.join(out, "assetcatalog_generated_info.plist"),
		"--app-icon",
		"Icon",
		"--include-all-app-icons",
		"--enable-on-demand-resources",
		"NO",
		"--development-region",
		"en",
		"--target-device",
		"mac",
		"--minimum-deployment-target",
		"26.0",
		"--platform",
		"macosx",
	],
	{ stdio: "inherit" },
);
const staged = path.join(ROOT, ".stage", "Assets.car");
fs.mkdirSync(path.dirname(staged), { recursive: true });
fs.copyFileSync(path.join(out, "Assets.car"), staged);
fs.rmSync(work, { recursive: true });

console.log(`[compile-icon] wrote ${path.relative(ROOT, staged)}`);
