/**
 * fetch-onnxruntime.mjs — download ONNX Runtime's library for Linux into .stage/.
 *
 * Only Linux loads ONNX Runtime at run time: the static build `ort` links in on macOS and Windows
 * needs a newer glibc than the Linux app supports. This is Microsoft's own release, the version
 * `ort` 2.0.0-rc.13 links in elsewhere (fetch-library.mjs checks it). The Linux desktop builds run
 * this before `tauri build`; the bundle config ships the file beside the server.
 */
import { fetchLibrary } from "./fetch-library.mjs";

const VERSION = "1.28.0";

if (`${process.platform}-${process.arch}` !== "linux-x64") {
	console.error(`[fetch-onnxruntime] only the x64 Linux build loads ONNX Runtime at run time, not ${process.platform}-${process.arch}`);
	process.exit(1);
}
await fetchLibrary("fetch-onnxruntime", {
	url: `https://github.com/microsoft/onnxruntime/releases/download/v${VERSION}/onnxruntime-linux-x64-${VERSION}.tgz`,
	archiveSha256: "a3e1b79d7bb1bf09696ce675f49e4064e6c81f6202b8225624fff0e93f8d6407",
	member: `onnxruntime-linux-x64-${VERSION}/lib/libonnxruntime.so.${VERSION}`,
	librarySha256: "1461ef7cc3d9e49982591721683cc3e3a55580aeca9a5254e7aac47b75ee4bab",
	file: "libonnxruntime.so",
});
