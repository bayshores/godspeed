//! A login token lasts 60 s by the app clock (its own test binary: it moves the clock).

use gs_base::clock;
use gs_shell_rpc::{ShellLink, ToServer};

#[test]
fn a_token_expires_after_60_seconds() {
	let link = ShellLink::new(std::io::sink());
	let login = |id: u64, token: &str| link.receive(ToServer::Login { id, token: token.to_owned() });

	let soon = "a".repeat(64);
	login(1, &soon);
	clock::advance(59_000);
	assert!(link.take_login(&soon), "still good just under a minute later");

	let late = "b".repeat(64);
	login(2, &late);
	clock::advance(60_000);
	assert!(!link.take_login(&late), "expired after a minute");
}
