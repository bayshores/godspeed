//! The change detector for a class file: a hash of its bytes.

use std::path::Path;

use gs_base::hash::Hasher;
use tokio::io::AsyncReadExt;

use crate::ioerr::{open_failed, read_failed};

/// sha256 of the file's bytes, 16 hex chars. Streamed in 64 KiB pieces: a whole-file read of a
/// big PDF would hold up every other request while it hashed.
pub async fn fingerprint_file(file: &Path) -> Result<String, String> {
	let mut input = tokio::fs::File::open(file).await.map_err(|e| open_failed(&e, file))?;
	let mut hasher = Hasher::new();
	let mut chunk = vec![0u8; 64 * 1024];
	loop {
		let n = input.read(&mut chunk).await.map_err(|e| read_failed(&e))?;
		if n == 0 {
			break;
		}
		hasher.update(&chunk[..n]);
	}
	Ok(hasher.hex()[..16].to_owned())
}
