//! A fresh Path for an agent's terminal: the system's and the account's as the registry has them
//! now, so an agent installed after godspeed opened is found.

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use windows::Win32::Foundation::ERROR_MORE_DATA;
use windows::Win32::System::Registry::{HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW};
use windows::core::{HSTRING, PCWSTR};

/// A string value, with any `%VARIABLE%` in it expanded.
fn read(key: HKEY, subkey: &str, name: &str) -> Option<OsString> {
	let (subkey, name) = (HSTRING::from(subkey), HSTRING::from(name));
	let mut bytes = 0u32;
	// SAFETY: the size query writes only `bytes`.
	unsafe { RegGetValueW(key, PCWSTR(subkey.as_ptr()), PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, None, Some(&raw mut bytes)) }.ok().ok()?;
	// Expanded, the value can come out longer than the size query said; the failed read then
	// leaves the size it needs in `bytes`, so once more.
	for _ in 0..2 {
		let mut buffer = vec![0u16; (bytes as usize).div_ceil(2)];
		// SAFETY: the read writes at most `bytes` into a buffer that large.
		let read = unsafe { RegGetValueW(key, PCWSTR(subkey.as_ptr()), PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&raw mut bytes)) };
		if read == ERROR_MORE_DATA {
			continue;
		}
		read.ok().ok()?;
		let length = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
		return Some(OsString::from_wide(&buffer[..length]));
	}
	None
}

/// Replaces `Path` with the registry's system and account halves. Without both, the app's own
/// stays: one half alone loses `where.exe` or the agents installed for the account.
pub fn refresh(env: &mut Vec<(OsString, OsString)>) {
	let system = read(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment", "Path");
	let user = read(HKEY_CURRENT_USER, "Environment", "Path");
	let (Some(mut path), Some(user)) = (system, user) else { return };
	path.push(";");
	path.push(user);
	env.retain(|(key, _)| !key.to_str().is_some_and(|key| key.eq_ignore_ascii_case("Path")));
	env.push(("Path".into(), path));
}
