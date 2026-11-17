/**
 * fetch-onnxruntime.mjs — download ONNX Runtime's library into .stage/, where it loads at run time.
 *
 * Linux: the static build `ort` links in on Apple silicon Macs and Windows needs a newer glibc
 * than the Linux app supports, so Linux loads the same version (the one `ort` 2.0.0-rc.13 links
 * in). Intel Macs: 1.23.2 is the last version Microsoft released for them. Both come from
 * Microsoft's own NuGet package, since its GitHub repository is gone; the libraries inside are the
 * same bytes as the old GitHub releases (fetch-library.mjs checks them). The desktop builds run this
 * before `tauri build`; the bundle config ships the file with the app.
 */
import { fetchLibrary } from "./fetch-library.mjs";

const NUGET = "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime";
const BUILDS = {
	"linux-x64": {
		url: `${NUGET}/1.28.0/microsoft.ml.onnxruntime.1.28.0.nupkg`,
		archiveSha256: "769d1d3ea8ab6cd69f737c9dd4d4462aa4ad0ccfa106eaf506efc40d7bead5db",
		member: "runtimes/linux-x64/native/libonnxruntime.so",
		librarySha256: "1461ef7cc3d9e49982591721683cc3e3a55580aeca9a5254e7aac47b75ee4bab",
		file: "libonnxruntime.so",
	},
	"darwin-x64": {
		url: `${NUGET}/1.23.2/microsoft.ml.onnxruntime.1.23.2.nupkg`,
		archiveSha256: "25fe172f7fcdf34f2b5b02c8b997f6b88abc282956849d4af4335af23d0c4e4a",
		member: "runtimes/osx-x64/native/libonnxruntime.dylib",
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
