//! Random ids in today's formats. Each shape matches one TypeScript expression:
//!
//! | Shape | TypeScript | Used for |
//! | --- | --- | --- |
//! | `timed("chat")` → `chat_<base36 now>_<8 hex>` | `` `chat_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}` `` | chat, job, spc, msg, pb |
//! | `uuid_hex("f", 12)` → `f_<12 hex>` | `` `f_${randomUUID().replace(/-/g, "").slice(0, 12)}` `` | f (12), ddl (12), act (12), tpc (10) |
//! | `bytes_hex("n", 6)` → `n_<12 hex>` | `` `n_${randomBytes(6).toString("hex")}` `` | n (6), arg (6), note (4) |
//! | `uuid_head("agent", 12)` → `agent_<8 hex>-<3 hex>` | `` `agent_${randomUUID().slice(0, 12)}` `` | agent, work |
//! | `uuid()` | `randomUUID()` | compaction, cheat sheet entries, usage ids, temp names |

use crate::{clock, num};

/// `n` random bytes (`crypto.randomBytes(n)`).
pub fn random_bytes(n: usize) -> Vec<u8> {
	let mut buf = vec![0; n];
	getrandom::fill(&mut buf).expect("the OS random source works");
	buf
}

pub fn hex(bytes: &[u8]) -> String {
	bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `crypto.randomUUID()`: a version 4 UUID in lowercase.
pub fn uuid() -> String {
	let mut b = random_bytes(16);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	let h = hex(&b);
	format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

/// `<prefix>_<base36 Date.now()>_<first 8 chars of a UUID>`.
pub fn timed(prefix: &str) -> String {
	format!("{prefix}_{}_{}", num::base36(clock::now_ms().max(0) as u64), &uuid()[..8])
}

/// `<prefix>_<first n hex digits of a UUID without dashes>`.
pub fn uuid_hex(prefix: &str, n: usize) -> String {
	format!("{prefix}_{}", &uuid().replace('-', "")[..n])
}

/// `<prefix>_<n random bytes in hex>`.
pub fn bytes_hex(prefix: &str, n: usize) -> String {
	format!("{prefix}_{}", hex(&random_bytes(n)))
}

/// `<prefix>_<first n chars of a UUID, dash included>`.
pub fn uuid_head(prefix: &str, n: usize) -> String {
	format!("{prefix}_{}", &uuid()[..n])
}

#[cfg(test)]
mod tests {
	use super::*;

	fn shape(id: &str, re: &str) -> bool {
		crate::re::Re::new(re, "").test(id)
	}

	#[test]
	fn ids_have_todays_shapes() {
		assert!(shape(&uuid(), "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"));
		assert!(shape(&timed("chat"), "^chat_[0-9a-z]{8,9}_[0-9a-f]{8}$"));
		assert!(shape(&uuid_hex("tpc", 10), "^tpc_[0-9a-f]{10}$"));
		assert!(shape(&bytes_hex("note", 4), "^note_[0-9a-f]{8}$"));
		assert!(shape(&uuid_head("work", 12), "^work_[0-9a-f]{8}-[0-9a-f]{3}$"));
	}
}
