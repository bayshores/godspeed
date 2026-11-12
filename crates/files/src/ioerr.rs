//! Node's words for a failed file read: `open` names the path, a failed `read` (a folder opens
//! fine and fails there, as can a Drive file that is offline) names none.

use std::io::{self, Read};
use std::path::Path;

use gs_base::fsx::node_error_message;

pub(crate) fn open_failed(err: &io::Error, path: &Path) -> String {
	node_error_message(err, "open", path)
}

pub(crate) fn read_failed(err: &io::Error) -> String {
	let message = node_error_message(err, "read", Path::new(""));
	message.strip_suffix(" ''").map_or_else(|| message.clone(), str::to_owned)
}

/// `fs.readFileSync(path)` with its error text.
pub(crate) fn read_file(path: &Path) -> Result<Vec<u8>, String> {
	let mut bytes = Vec::new();
	std::fs::File::open(path).map_err(|e| open_failed(&e, path))?.read_to_end(&mut bytes).map_err(|e| read_failed(&e))?;
	Ok(bytes)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_failed_read_names_no_path() {
		let dir = std::env::temp_dir();
		if cfg!(unix) {
			assert_eq!(read_file(&dir), Err("EISDIR: illegal operation on a directory, read".to_owned()));
		}
		let gone = dir.join(format!("gs-files-gone-{}", gs_base::ids::uuid()));
		assert_eq!(read_file(&gone), Err(format!("ENOENT: no such file or directory, open '{}'", gone.display())));
		assert_eq!(read_failed(&io::Error::from(io::ErrorKind::PermissionDenied)), "EACCES: permission denied, read");
	}
}
