/**
 * stage-app.mjs — put together what `tauri build` bundles (its beforeBuildCommand).
 *
 * Builds the UI (dist-ui/) and the release server, copies the server to
 * crates/shell/binaries/godspeed-server-<target triple> (where the bundle's externalBin looks),
 * copies the pdf.js files the server serves to .stage/pdfjs-dist/, and checks that the search model
 * (scripts/fetch-model.mjs) and pdfium's library (scripts/fetch-pdfium.mjs) are there and that
 * nothing private rides along in the UI. ONNX Runtime is linked into the server statically.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAGE = path.join(ROOT, ".stage");
const UI = path.join(ROOT, "dist-ui");
const WINDOWS = process.platform === "win32";
const PDFIUM = { darwin: "libpdfium.dylib", win32: "pdfium.dll" }[process.platform] ?? "libpdfium.so";
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

run(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"]);
if (!fs.existsSync(path.join(UI, "index.html"))) fail("dist-ui/index.html is missing after `vite build`.");

// The repo's real data/ and the dev secrets must never ride along in the app. auth.json is the
// retired API-key store: old checkouts may still hold one, so it stays refused.
if (fs.existsSync(path.join(UI, "data"))) fail("REFUSING: dist-ui holds a data/ folder, so session data would ship in the app.");
const secret = /^(auth\.json|(chatgpt|github-copilot|xai)-credentials\.json.*|\.env|\.env\.local)$/;
for (const file of fs.readdirSync(UI, { recursive: true })) {
	if (secret.test(path.basename(file))) fail(`REFUSING: dist-ui holds ${file}, so a dev secret would ship in the app.`);
}

const triple = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
run("cargo", ["build", "--release", "-p", "gs-server", "--target", triple]);
const server = path.join(ROOT, "target", triple, "release", WINDOWS ? "godspeed-server.exe" : "godspeed-server");
const staged = path.join(ROOT, "crates", "shell", "binaries", `godspeed-server-${triple}${WINDOWS ? ".exe" : ""}`);
fs.mkdirSync(path.dirname(staged), { recursive: true });
fs.copyFileSync(server, staged);

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

console.log(`[stage-app] staged ${path.relative(ROOT, staged)} and ${copied} pdf.js files`);
