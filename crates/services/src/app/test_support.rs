//! A scratch folder and a small `App` on it, for this module's unit tests.

use std::io::Write;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;
use gs_shell_rpc::ShellLink;
use tokio::sync::mpsc;

use crate::App;

/// A new folder under the system temp folder, removed when dropped.
pub struct Scratch(PathBuf);

impl Deref for Scratch {
	type Target = Path;
	fn deref(&self) -> &Path {
		&self.0
	}
}

impl Drop for Scratch {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

pub fn scratch_dir(label: &str) -> Scratch {
	let dir = std::env::temp_dir().join(format!("gs-app-{label}-{}", ids::uuid()));
	std::fs::create_dir_all(&dir).expect("the temp folder is writable");
	Scratch(dir)
}

/// An `App` whose data, home, tmp and resources folders are `root`'s `data`, `home`, `tmp` and
/// `res`.
pub fn test_app(root: &Path) -> Arc<App> {
	app_on(root, None)
}

/// A `test_app` with a desktop shell: the receiver gets each line the server writes to it.
pub fn test_app_with_shell(root: &Path) -> (Arc<App>, mpsc::UnboundedReceiver<Vec<u8>>) {
	let (tx, rx) = mpsc::unbounded_channel();
	(app_on(root, Some(ShellLink::new(Lines(tx)))), rx)
}

fn app_on(root: &Path, shell: Option<ShellLink>) -> Arc<App> {
	for name in ["data", "home", "tmp", "res"] {
		std::fs::create_dir_all(root.join(name)).expect("the scratch folder is writable");
	}
	App::new(Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), shell)
}

/// Hands each line the server writes to the shell to the test.
struct Lines(mpsc::UnboundedSender<Vec<u8>>);

impl Write for Lines {
	fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
		let _ = self.0.send(buf.to_vec());
		Ok(buf.len())
	}
	fn flush(&mut self) -> std::io::Result<()> {
		Ok(())
	}
}
