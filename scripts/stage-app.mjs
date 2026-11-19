/**
 * stage-app.mjs — build what `tauri bundle` packs.
 *
 * Builds the UI (dist-ui/) and the release server, copies the server to
 * crates/shell/binaries/godspeed-server-<target triple> (where the bundle's externalBin looks),
 * copies the pdf.js files the server serves to .stage/pdfjs-dist/, and checks that the search model
 * (scripts/fetch-model.mjs), pdfium's library (scripts/fetch-pdfium.mjs) and, on Linux and Intel
 * Macs, ONNX Runtime's library (scripts/fetch-onnxruntime.mjs) are there and that nothing private
 * rides along in the UI. Apple silicon Macs and Windows link ONNX Runtime into the server.
 *
 * `--app <options>` also builds the app's own binary, with `tauri build --no-bundle <options>`.
 * The server and the app each end in a release link of several minutes, and each link takes
 * several GB of memory. With 12 GB or more the two builds run side by side: one target folder
 * takes one cargo at a time, and one cargo for both would mix their dependencies' features, so
 * the server has its own folder, target/server/. With less memory (GitHub's 7 GB Apple chip
 * Mac) side by side they swap, so they run in a row in one folder, where the second build
 * reuses what the first compiled.
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAGE = path.join(ROOT, ".stage");
const UI = path.join(ROOT, "dist-ui");
const WINDOWS = process.platform === "win32";
const PDFIUM = { darwin: "libpdfium.dylib", win32: "pdfium.dll" }[process.platform] ?? "libpdfium.so";
const ONNXRUNTIME = { "linux-x64": "libonnxruntime.so", "darwin-x64": "libonnxruntime.dylib" }[`${process.platform}-${process.arch}`];
const MODEL_WEIGHTS = path.join("models", "Snowflake", "snowflake-arctic-embed-xs", "onnx", "model_quantized.onnx");

/** The pdf.js files crates/server/src/http/ui.rs serves (not its scripting engine), with their licenses. */
const PDFJS_FILES = [
	/^build\/pdf\.worker\.min\.mjs$/,
	/^standard_fonts\/[A-Za-z0-9_-]+\.(pfb|ttf)$/,
	/^cmaps\/[A-Za-z0-9_-]+\.bcmap$/,
	/^iccs\/[A-Za-z0-9_-]+\.icc$/,
	/^wasm\/(jbig2|openjpeg|qcms_bg)\.wasm$/,
	/^wasm\/(jbig2|openjpeg)_nowasm_fallback\.js$/,
	/(^|\/)LICENSE[A-Z0-9_]*$/,
];

const fail = (message) => {
	console.error(`[stage-app] ${message}`);
	process.exit(1);
};
const run = (command, args) => execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });

// Missing inputs fail before the slow builds start.
if (!fs.existsSync(path.join(ROOT, MODEL_WEIGHTS))) fail("the search model is missing, run `node scripts/fetch-model.mjs` first.");
if (!fs.existsSync(path.join(STAGE, PDFIUM))) fail(`.stage/${PDFIUM} is missing, run \`node scripts/fetch-pdfium.mjs\` first.`);
if (ONNXRUNTIME && !fs.existsSync(path.join(STAGE, ONNXRUNTIME))) fail(`.stage/${ONNXRUNTIME} is missing, run \`node scripts/fetch-onnxruntime.mjs\` first.`);

run(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"]);
if (!fs.existsSync(path.join(UI, "index.html"))) fail("dist-ui/index.html is missing after `vite build`.");

// The repo's real data/ and the dev secrets must never ride along in the app. auth.json is the
// retired API-key store: old checkouts may still hold one, so it stays refused.
if (fs.existsSync(path.join(UI, "data"))) fail("REFUSING: dist-ui holds a data/ folder, so session data would ship in the app.");
const secret = /^(auth\.json|(chatgpt|github-copilot|xai)-credentials\.json.*|\.env|\.env\.local)$/;
for (const file of fs.readdirSync(UI, { recursive: true })) {
	if (secret.test(path.basename(file))) fail(`REFUSING: dist-ui holds ${file}, so a dev secret would ship in the app.`);
}

const pdfjs = path.join(ROOT, "node_modules", "pdfjs-dist");
const pdfjsOut = path.join(STAGE, "pdfjs-dist");
fs.rmSync(pdfjsOut, { recursive: true, force: true });
let copied = 0;
for (const file of fs.readdirSync(pdfjs, { recursive: true })) {
	const name = file.replaceAll("\\", "/");
	if (!PDFJS_FILES.some((pattern) => pattern.test(name))) continue;
	fs.mkdirSync(path.dirname(path.join(pdfjsOut, name)), { recursive: true });
	fs.copyFileSync(path.join(pdfjs, name), path.join(pdfjsOut, name));
	copied += 1;
}
if (!fs.existsSync(path.join(pdfjsOut, "build", "pdf.worker.min.mjs"))) fail("pdf.js's worker is missing, run `npm ci` first.");

const triple = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const together = os.totalmem() >= 12 * 2 ** 30;
const serverTarget = together ? path.join("target", "server") : "target";
const builds = [["cargo", ["build", "--release", "-p", "gs-server", "--target", triple, "--target-dir", serverTarget]]];
if (process.argv[2] === "--app") {
	// The app's build step copies externalBin and fails without it, and the server is still being
	// built, so this build names none. The bundler reads the list again from its own options.
	const options = [...process.argv.slice(3), "--config", JSON.stringify({ bundle: { externalBin: [] } })];
	builds.push([process.execPath, [path.join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--no-bundle", ...options]]);
}
/** A build under way; `done` settles with its exit code, its signal, or why it did not start. */
function start([command, args]) {
	const child = spawn(command, args, { cwd: ROOT, stdio: "inherit" });
	const done = new Promise((resolve) => {
		child.on("error", (err) => resolve(err.message));
		child.on("exit", (code, signal) => resolve(code ?? signal));
	});
	return { child, done };
}
const codes = [];
if (together) {
	const running = builds.map(start);
	for (const { child, done } of running) {
		// One failed build ends the other: its minutes would be wasted.
		void done.then((code) => {
			if (code !== 0) for (const other of running) if (other.child !== child) other.child.kill();
		});
	}
	codes.push(...(await Promise.all(running.map((build) => build.done))));
} else {
	for (const build of builds) {
		codes.push(await start(build).done);
		if (codes.at(-1) !== 0) break;
	}
}
const failed = codes.findIndex((code) => code !== 0);
if (failed !== -1) fail(`\`${builds[failed][0]} ${builds[failed][1].slice(0, 2).join(" ")}\` failed (${codes[failed]}).`);

const server = path.join(ROOT, serverTarget, triple, "release", WINDOWS ? "godspeed-server.exe" : "godspeed-server");
const staged = path.join(ROOT, "crates", "shell", "binaries", `godspeed-server-${triple}${WINDOWS ? ".exe" : ""}`);
fs.mkdirSync(path.dirname(staged), { recursive: true });
fs.copyFileSync(server, staged);

console.log(`[stage-app] staged ${path.relative(ROOT, staged)} and ${copied} pdf.js files`);
