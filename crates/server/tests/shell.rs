//! Started by the desktop shell (`LH_SHELL=1`), the server says it is ready on stdout, logs the
//! window in with a token the shell sent, and stops when its stdin closes.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use gs_base::ids;

fn temp_dir() -> PathBuf {
	let dir = std::env::temp_dir().join(format!("gs-shell-{}", ids::uuid()));
	for sub in ["data", "home", "tmp"] {
		std::fs::create_dir_all(dir.join(sub)).unwrap();
	}
	dir
}

fn start(dir: &Path, port: u16, secret: Option<&str>) -> (Child, BufReader<ChildStdout>) {
	let mut cmd = Command::new(env!("CARGO_BIN_EXE_godspeed-server"));
	cmd.current_dir(dir)
		.env("LH_SHELL", "1")
		.env("PORT", port.to_string())
		.env("LH_DATA_DIR", dir.join("data"))
		.env("HOME", dir.join("home"))
		.env("USERPROFILE", dir.join("home"))
		.env("TMPDIR", dir.join("tmp"))
		.env("TEMP", dir.join("tmp"))
		.env("TMP", dir.join("tmp"))
		.env_remove("LH_DESKTOP_SERVER")
		.env_remove("LH_DESKTOP_API_SECRET")
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::null());
	if let Some(secret) = secret {
		cmd.env("LH_DESKTOP_SERVER", "1").env("LH_DESKTOP_API_SECRET", secret);
	}
	let mut child = cmd.spawn().unwrap();
	let mut out = BufReader::new(child.stdout.take().unwrap());
	assert_eq!(line(&mut out), "{\"t\":\"ready\"}\n");
	(child, out)
}

fn line(out: &mut BufReader<ChildStdout>) -> String {
	let mut line = String::new();
	out.read_line(&mut line).unwrap();
	line
}

/// The status line and headers of a GET.
fn get(port: u16, target: &str, headers: &str) -> String {
	let mut conn = TcpStream::connect(("127.0.0.1", port)).unwrap();
	write!(conn, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n{headers}\r\n").unwrap();
	let mut answer = String::new();
	conn.read_to_string(&mut answer).unwrap();
	answer.split("\r\n\r\n").next().unwrap().to_owned()
}

fn free_port() -> u16 {
	std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port()
}

#[test]
fn says_ready_and_stops_when_stdin_closes() {
	let dir = temp_dir();
	let (mut child, _out) = start(&dir, 0, None);
	drop(child.stdin.take());
	let closed = Instant::now();
	let status = loop {
		if let Some(status) = child.try_wait().unwrap() {
			break status;
		}
		if closed.elapsed() > Duration::from_secs(3) {
			child.kill().unwrap();
			panic!("still running 3 s after stdin closed");
		}
		std::thread::sleep(Duration::from_millis(20));
	};
	assert_eq!(status.code(), Some(143));
	std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_login_token_opens_the_api_once() {
	let dir = temp_dir();
	let secret = "5e".repeat(32);
	let port = free_port();
	let (mut child, mut out) = start(&dir, port, Some(&secret));
	let token = "c0".repeat(32);
	writeln!(child.stdin.as_mut().unwrap(), "{{\"t\":\"login\",\"id\":1,\"token\":\"{token}\"}}").unwrap();
	assert_eq!(line(&mut out), "{\"t\":\"login_ok\",\"id\":1}\n");

	let window = format!("Cookie: gs_desktop={secret}\r\nSec-Fetch-Site: same-origin\r\n");
	assert!(get(port, "/api/nothing-here", "Sec-Fetch-Site: same-origin\r\n").starts_with("HTTP/1.1 403"), "no access without the cookie");

	let login = get(port, &format!("/api/desktop/login?token={token}"), "");
	assert!(login.starts_with("HTTP/1.1 303"), "{login}");
	let login = login.to_ascii_lowercase();
	assert!(login.contains("\r\nlocation: /\r\n"), "{login}");
	assert!(login.contains("\r\ncache-control: no-store\r\n"), "{login}");
	assert!(login.contains(&format!("\r\nset-cookie: gs_desktop={secret}; path=/; httponly; samesite=strict\r\n")), "{login}");
	assert!(get(port, &format!("/api/desktop/login?token={token}"), "").starts_with("HTTP/1.1 403"), "a token works once");
	assert!(get(port, "/api/desktop/login?token=", "").starts_with("HTTP/1.1 403"));

	assert!(get(port, "/api/nothing-here", &window).starts_with("HTTP/1.1 404"), "the window's cookie gets through");
	assert!(get(port, "/api/nothing-here", &format!("Cookie: gs_desktop={secret}\r\nSec-Fetch-Site: cross-site\r\n")).starts_with("HTTP/1.1 403"));

	drop(child.stdin.take());
	child.wait().unwrap();
	std::fs::remove_dir_all(&dir).unwrap();
}
