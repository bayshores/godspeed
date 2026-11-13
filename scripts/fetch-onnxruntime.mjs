/**
 * fetch-onnxruntime.mjs — download ONNX Runtime's library into .stage/, where it loads at run time.
 *
 * Linux: the static build `ort` links in on Apple silicon Macs and Windows needs a newer glibc
 * than the Linux app supports, so Linux loads the same version (the one `ort` 2.0.0-rc.13 links
 * in). Intel Macs: 1.23.2 is the last version Microsoft released for them. Both are Microsoft's
 * own releases (fetch-library.mjs checks them). The desktop builds run this before `tauri build`;
 * the bundle config ships the file with the app.
 */
import { fetchLibrary } from "./fetch-library.mjs";

const RELEASES = "https://github.com/microsoft/onnxruntime/releases/download";
const BUILDS = {
	"linux-x64": {
		url: `${RELEASES}/v1.28.0/onnxruntime-linux-x64-1.28.0.tgz`,
		archiveSha256: "a3e1b79d7bb1bf09696ce675f49e4064e6c81f6202b8225624fff0e93f8d6407",
		member: "onnxruntime-linux-x64-1.28.0/lib/libonnxruntime.so.1.28.0",
		librarySha256: "1461ef7cc3d9e49982591721683cc3e3a55580aeca9a5254e7aac47b75ee4bab",
		file: "libonnxruntime.so",
	},
	"darwin-x64": {
		url: `${RELEASES}/v1.23.2/onnxruntime-osx-x86_64-1.23.2.tgz`,
		archiveSha256: "d10359e16347b57d9959f7e80a225a5b4a66ed7d7e007274a15cae86836485a6",
		member: "onnxruntime-osx-x86_64-1.23.2/lib/libonnxruntime.1.23.2.dylib",
		librarySha256: "8c9c78de65ea3786f987c0d980e9c1b13a3a5fbc6b3e2965ba05b450e6e4c054",
		file: "libonnxruntime.dylib",
	},
};

const build = BUILDS[`${process.platform}-${process.arch}`];
if (!build) {
	console.error(`[fetch-onnxruntime] only x64 Linux and Intel Macs load ONNX Runtime at run time, not ${process.platform}-${process.arch}`);
	process.exit(1);
}
await fetchLibrary("fetch-onnxruntime", build);
