/**
 * dev-resources.mjs — make .dev-resources/, the folder a debug godspeed-server runs in.
 *
 * It holds what the app bundle ships beside the server: ui/ (dist-ui, from `npm run build`),
 * models/ (scripts/fetch-model.mjs), pdfjs-dist/ and the pdfium library. The library comes
 * from .stage/ (scripts/fetch-pdfium.mjs), else from the lab folder of the main checkout. Linux
 * also gets ONNX Runtime's library from .stage/ (scripts/fetch-onnxruntime.mjs).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".dev-resources");
const PDFIUM = { darwin: "libpdfium.dylib", win32: "pdfium.dll" }[process.platform] ?? "libpdfium.so";

// A worktree's lab lives in the main checkout, beside its .git folder.
const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
const pdfium = [path.join(root, ".stage", PDFIUM), path.join(path.dirname(commonDir), ".claude", "rewrite-lab", "pdfium", PDFIUM)].find((file) => fs.existsSync(file));
if (!pdfium) {
	console.error(`dev-resources: no ${PDFIUM} found. Run \`node scripts/fetch-pdfium.mjs\` to put it in .stage/.`);
	process.exit(1);
}
const onnxruntime = path.join(root, ".stage", "libonnxruntime.so");
if (process.platform === "linux" && !fs.existsSync(onnxruntime)) {
	console.error("dev-resources: no libonnxruntime.so found. Run `node scripts/fetch-onnxruntime.mjs` to put it in .stage/.");
	process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const [name, target] of [["ui", "dist-ui"], ["models", "models"], ["pdfjs-dist", "node_modules/pdfjs-dist"]]) {
	const from = path.join(root, target);
	if (!fs.existsSync(from)) console.warn(`dev-resources: ${target}/ is missing, so the server has no ${name}/ yet.`);
	// A junction needs no special rights on Windows; other systems ignore the type.
	fs.symlinkSync(from, path.join(out, name), "junction");
}
fs.copyFileSync(pdfium, path.join(out, PDFIUM));
if (process.platform === "linux") fs.copyFileSync(onnxruntime, path.join(out, "libonnxruntime.so"));
