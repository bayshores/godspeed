/**
 * fetch-pdfium.mjs — download pdfium's library for this OS into .stage/.
 *
 * The files come from one pinned bblanchon/pdfium-binaries release (fetch-library.mjs checks them).
 * The desktop builds run this before `tauri build`; the bundle config ships the file beside the app.
 */
import * as path from "node:path";

import { fetchLibrary } from "./fetch-library.mjs";

const RELEASE = "chromium%2F8125";
const BUILDS = {
	"darwin-arm64": {
		archive: "pdfium-mac-arm64.tgz",
		archiveSha256: "4939bd935ac83ddc09a3a4f038bc43a19cea1660316a3667f26cb07a070e139d",
		member: "lib/libpdfium.dylib",
		librarySha256: "a45c44645523968525c710462691dd974f4efb1013ce1c249919a0939cfb373a",
	},
	"darwin-x64": {
		archive: "pdfium-mac-x64.tgz",
		archiveSha256: "8a5193535b80c7215d8932f6647ae5097465b6dba2811602c21e120c2af112b0",
		member: "lib/libpdfium.dylib",
		librarySha256: "a9f428a16f46bab89646c8724b348e01c3fe707e3126d9356026cd876a74aecb",
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
await fetchLibrary("fetch-pdfium", {
	url: `https://github.com/bblanchon/pdfium-binaries/releases/download/${RELEASE}/${build.archive}`,
	archiveSha256: build.archiveSha256,
	member: build.member,
	librarySha256: build.librarySha256,
	file: path.basename(build.member),
});
