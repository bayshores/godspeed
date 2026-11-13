//! Shared by the integration tests that run the model.

/// Linux loads ONNX Runtime at run time: the tests take the copy `node scripts/fetch-onnxruntime.mjs`
/// puts in `.stage/`, which then serves the whole test process. macOS and Windows link it in.
pub fn load_runtime() {
	#[cfg(target_os = "linux")]
	ort::init_from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.stage/libonnxruntime.so")).expect(".stage/libonnxruntime.so is missing: run node scripts/fetch-onnxruntime.mjs").commit();
}
