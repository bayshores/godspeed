//! Shared by the integration tests that run the model.

/// Linux and Intel Macs load ONNX Runtime at run time: the tests take the copy
/// `node scripts/fetch-onnxruntime.mjs` puts in `.stage/`, which then serves the whole test
/// process. Apple silicon Macs and Windows link it in.
pub fn load_runtime() {
	#[cfg(target_os = "linux")]
	const LIBRARY: &str = "libonnxruntime.so";
	#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
	const LIBRARY: &str = "libonnxruntime.dylib";
	#[cfg(any(target_os = "linux", all(target_os = "macos", target_arch = "x86_64")))]
	ort::init_from(format!("{}/../../.stage/{LIBRARY}", env!("CARGO_MANIFEST_DIR"))).expect("ONNX Runtime is missing from .stage/: run node scripts/fetch-onnxruntime.mjs").commit();
}
