/**
 * fetch-pdfium.mjs — download pdfium's library for this OS into .stage/.
 *
 * .stage/ is gitignored. The files come from one pinned bblanchon/pdfium-binaries release and are
 * checked by sha256 (the archive, then the library inside it), so every build ships the same
 * bytes. A library already present with the right hash is skipped. The desktop builds run this
 * before `tauri build`; the bundle config ships the file beside the app.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const RELEASE = "chromium%2F8125";
const BUILDS = {
	"darwin-arm64": {
		archive: "pdfium-mac-arm64.tgz",
		archiveSha256: "4939bd935ac83ddc09a3a4f038bc43a19cea1660316a3667f26cb07a070e139d",
		member: "lib/libpdfium.dylib",
		librarySha256: "a45c44645523968525c710462691dd974f4efb1013ce1c249919a0939cfb373a",
	},
	"win32-x64": {
		archive: "pdfium-win-x64.tgz",
		archiveSha256: "9a964261760cff52570aabf038ab346d3a5034dd8b30d0d5fe8861235d356b8b",
		member: "bin/pdfium.dll",
		librarySha256: "4b0dec92555d69437bef0df37be630181ab3e83a6823ca264ede355a4f2ef994",
	},
	"linux-x64": {
		archive: "pdfium-linux-x64.tgz",
		archiveSha256: "e1c3ce6e270cb5e0c20816b379ad9f2c1309972697c505f508de92bf5e7d6659",
		member: "lib/libpdfium.so",
		librarySha256: "1c251efce460d67437a4c76d4be9033ae2f17bf5603f5bff1af10209b94ca723",
	},
};

const build = BUILDS[`${process.platform}-${process.arch}`];
if (!build) {
	console.error(`[fetch-pdfium] no pdfium build is pinned for ${process.platform}-${process.arch}`);
	process.exit(1);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const target = path.join(path.resolve(import.meta.dirname, ".."), ".stage", path.basename(build.member));

if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === build.librarySha256) {
	console.log("[fetch-pdfium] pdfium ready:", target);
	process.exit(0);
}

const url = `https://github.com/bblanchon/pdfium-binaries/releases/download/${RELEASE}/${build.archive}`;
const res = await fetch(url);
if (!res.ok) {
	console.error(`[fetch-pdfium] ${url}: HTTP ${res.status}`);
	process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
if (sha256(bytes) !== build.archiveSha256) {
	console.error(`[fetch-pdfium] ${build.archive}: sha256 mismatch, refusing to use it`);
	process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "gs-pdfium-"));
let library;
try {
	fs.writeFileSync(path.join(work, build.archive), bytes);
	// A bare file name: GNU tar (first on PATH in Git Bash) reads `C:\…` as a remote host.
	execFileSync("tar", ["-xzf", build.archive, build.member], { cwd: work });
	library = fs.readFileSync(path.join(work, build.member));
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
if (sha256(library) !== build.librarySha256) {
	console.error(`[fetch-pdfium] ${build.member}: sha256 mismatch, refusing to use it`);
	process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, library);
console.log(`[fetch-pdfium] ${path.basename(target)} (${library.length} bytes)`);
console.log("[fetch-pdfium] pdfium ready:", target);
