//! One JSON object per `\n`-terminated UTF-8 line, both ways.

use std::io::{self, BufRead, Write};

use serde::Serialize;
use serde::de::DeserializeOwned;

/// The messages on `input` until it ends (or fails to read). A line that is not a `T` comes as an
/// Err for the caller to log and skip, so one bad line never ends the stream.
pub fn read_lines<T: DeserializeOwned>(mut input: impl BufRead) -> impl Iterator<Item = Result<T, String>> {
	std::iter::from_fn(move || {
		let mut line = Vec::new();
		match input.read_until(b'\n', &mut line) {
			Ok(0) | Err(_) => None,
			Ok(_) => Some(parse(&line)),
		}
	})
}

fn parse<T: DeserializeOwned>(line: &[u8]) -> Result<T, String> {
	let line = line.strip_suffix(b"\n").unwrap_or(line);
	let text = std::str::from_utf8(line).map_err(|_| "skipped a line that is not UTF-8".to_owned())?;
	serde_json::from_str(text).map_err(|err| format!("skipped an unknown line: {err}"))
}

/// Writes `msg` as one line in a single write, then flushes, so lines from several threads never
/// mix and the other side sees each at once.
pub fn write_line(out: &mut impl Write, msg: &impl Serialize) -> io::Result<()> {
	let mut line = serde_json::to_vec(msg)?;
	line.push(b'\n');
	out.write_all(&line)?;
	out.flush()
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::ToShell;

	#[test]
	fn reads_every_line_and_reports_bad_ones() {
		let input = b"{\"t\":\"ready\"}\nnope\n\xff\n{\"t\":\"login_ok\",\"id\":7}";
		let got: Vec<Result<ToShell, String>> = read_lines(&input[..]).collect();
		assert_eq!(got.len(), 4);
		assert_eq!(got[0], Ok(ToShell::Ready));
		assert!(got[1].as_ref().unwrap_err().starts_with("skipped an unknown line"));
		assert_eq!(got[2], Err("skipped a line that is not UTF-8".to_owned()));
		assert_eq!(got[3], Ok(ToShell::LoginOk { id: 7 }));
	}

	#[test]
	fn writes_one_terminated_line() {
		let mut out = Vec::new();
		write_line(&mut out, &ToShell::Demo { id: 1, html: "a\nb".into(), probe: None }).unwrap();
		write_line(&mut out, &ToShell::Ready).unwrap();
		assert_eq!(String::from_utf8(out).unwrap(), "{\"t\":\"demo\",\"id\":1,\"html\":\"a\\nb\",\"probe\":null}\n{\"t\":\"ready\"}\n");
	}
}
