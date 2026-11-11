//! Throwaway folders for the tests, and the sandbox: stand-in ffmpeg and whisper-cli
//! (tests/fixtures), the model file, and the temp and recording folders.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use gs_base::config::Paths;
use gs_base::re::Re;
use gs_json::{Json, parse};

/// A temp folder removed on drop.
pub(crate) struct Scratch(pub PathBuf);

impl Scratch {
	pub fn new(tag: &str) -> Scratch {
		let dir = std::env::temp_dir().join(format!("gs-transcribe-{tag}-{}", gs_base::ids::uuid()));
		std::fs::create_dir_all(&dir).unwrap();
		Scratch(dir)
	}
}

impl Drop for Scratch {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

pub(crate) struct Sandbox {
	_scratch: Scratch,
	pub root: PathBuf,
	pub paths: Paths,
	pub bin: PathBuf,
	pub recordings: PathBuf,
	pub out: PathBuf,
}

impl Sandbox {
	pub fn new() -> Sandbox {
		let scratch = Scratch::new("test");
		let root = scratch.0.clone();
		let (bin, recordings) = (root.join("bin"), root.join("recordings"));
		for dir in [&bin, &recordings, &root.join("tmp"), &root.join("data").join("models")] {
			std::fs::create_dir_all(dir).unwrap();
		}
		for name in ["ffmpeg", "whisper-cli"] {
			install(&bin.join(name), &std::fs::read_to_string(fixture(name)).unwrap());
		}
		gs_base::fsx::write_text_atomic(&root.join("data/models/ggml-base.en.bin"), "stub speech model\n").unwrap();
		let paths = Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res"));
		Sandbox { _scratch: scratch, out: root.join("out"), paths, bin, recordings, root }
	}

	/// A PATH holding only the stand-ins.
	pub fn path_env(&self) -> String {
		self.bin.to_string_lossy().into_owned()
	}

	/// Output text with the temp folder and the random work folder name masked, like the golden's.
	pub fn tidy(&self, text: &str) -> String {
		let masked = text.replace(&*self.root.to_string_lossy(), "<root>");
		Re::new("godspeed-transcribe-[A-Za-z0-9]{6}", "g").replace(&masked, "godspeed-transcribe-XXXXXX")
	}

	pub fn calls(&self) -> String {
		std::fs::read_to_string(self.bin.join("calls.log")).unwrap_or_default()
	}

	pub fn tmp_entries(&self) -> Vec<String> {
		let mut names: Vec<String> = std::fs::read_dir(self.root.join("tmp")).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
		names.sort();
		names
	}
}

/// Writes an executable script.
pub(crate) fn install(file: &Path, body: &str) {
	gs_base::fsx::write_text_atomic(file, body).unwrap();
	std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).unwrap();
}

pub(crate) fn fixture(name: &str) -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

/// One case's output from tests/golden/transcribe.json.
pub(crate) fn golden(case: &str) -> Json {
	let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/transcribe.json");
	let all = parse(&std::fs::read_to_string(file).unwrap()).unwrap();
	all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(case)).unwrap_or_else(|| panic!("no golden case {case}"))["output"].clone()
}
