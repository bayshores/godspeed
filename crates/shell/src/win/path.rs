//! A fresh Path for an agent's terminal: the system's and the account's as the registry has them
//! now, so an agent installed after godspeed opened is found.

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use windows::Win32::System::Registry::{HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW};
use windows::core::{HSTRING, PCWSTR};

/// A string value, with any `%VARIABLE%` in it expanded.
fn read(key: HKEY, subkey: &str, name: &str) -> Option<OsString> {
	let (subkey, name) = (HSTRING::from(subkey), HSTRING::from(name));
	let mut bytes = 0u32;
	// SAFETY: the size query writes only `bytes`; the read writes at most `bytes` into a buffer
	// that large.
	unsafe {
		RegGetValueW(key, PCWSTR(subkey.as_ptr()), PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, None, Some(&raw mut bytes)).ok().ok()?;
		let mut buffer = vec![0u16; (bytes as usize).div_ceil(2)];
		RegGetValueW(key, PCWSTR(subkey.as_ptr()), PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&raw mut bytes)).ok().ok()?;
		let length = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
		Some(OsString::from_wide(&buffer[..length]))
	}
}

/// Replaces `Path` with the registry's, when the registry has one.
pub fn refresh(env: &mut Vec<(OsString, OsString)>) {
	let system = read(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment", "Path");
	let user = read(HKEY_CURRENT_USER, "Environment", "Path");
	let Some(path) = [system, user].into_iter().flatten().reduce(|mut all, more| {
		all.push(";");
		all.push(more);
		all
	}) else {
		return;
	};
	env.retain(|(key, _)| !key.to_str().is_some_and(|key| key.eq_ignore_ascii_case("Path")));
	env.push(("Path".into(), path));
}
