//! Claude Code's sign-in on a stand-in `claude` that prints what the real one prints with no
//! terminal: the link, then the prompt for a code, which has no line end.

use super::*;

#[test]
fn the_link_is_read_once_its_line_is_whole() {
	let printed = "Opening browser to sign in…\nIf the browser didn't open, visit:\nhttps://claude.com/cai/oauth/authorize?code=true&state=s\nPaste code here if prompted > ";
	assert_eq!(sign_in_link(printed), Some("https://claude.com/cai/oauth/authorize?code=true&state=s"));
	assert_eq!(sign_in_link("visit:\nhttps://claude.com/cai/oauth/auth"), None, "half a line");
	// A terminal hyperlink (OSC 8) around the link.
	let linked = "visit:\n\x1b]8;;https://claude.com/cai/oauth/authorize?state=s\x07https://claude.com/cai/oauth/authorize?state=s\x1b]8;;\x07\n";
	assert_eq!(sign_in_link(linked), Some("https://claude.com/cai/oauth/authorize?state=s"));
}

#[cfg(unix)]
mod stand_in {
	use std::ffi::OsString;
	use std::path::PathBuf;

	use super::*;
	use crate::process::NO_CLAUDE;

	const LINK: &str = "https://claude.com/cai/oauth/authorize?code=true&client_id=c&state=s";

	/// A folder holding a stand-in `claude` whose `auth login` prints the link and the prompt,
	/// then runs `then` (with `$dir` its folder).
	struct Folder(PathBuf);

	impl Folder {
		fn new(name: &str, then: &str) -> Folder {
			let prints = format!("printf 'Opening browser to sign in…\\nIf the browser didn'\\''t open, visit:\\n{LINK}\\nPaste code here if prompted > '\n");
			Folder::with_script(name, &format!("echo \"$@\" > \"$dir/args\"\necho $$ > \"$dir/pid\"\n{prints}{then}"))
		}

		fn with_script(name: &str, body: &str) -> Folder {
			use std::os::unix::fs::PermissionsExt;
			let dir = std::env::temp_dir().join(format!("gs-claude-login-{name}-{}", gs_base::ids::uuid()));
			std::fs::create_dir_all(&dir).unwrap();
			let claude = dir.join("claude");
			gs_base::fsx::write_text_atomic(&claude, &format!("#!/bin/sh\ndir='{}'\n{body}", dir.display())).unwrap();
			std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
			Folder(dir)
		}

		fn env(&self) -> AgentEnv {
			AgentEnv::fixed(vec![(OsString::from("PATH"), OsString::from(format!("{}:/usr/bin:/bin", self.0.display())))])
		}

		fn read(&self, name: &str) -> String {
			std::fs::read_to_string(self.0.join(name)).unwrap_or_default()
		}
	}

	impl Drop for Folder {
		fn drop(&mut self) {
			let _ = std::fs::remove_dir_all(&self.0);
		}
	}

	#[tokio::test]
	async fn the_link_comes_back_and_a_pasted_code_reaches_its_input() {
		let folder = Folder::new("code", "read -r code\necho \"$code\" > \"$dir/code\"\necho 'Login successful.'\n");
		let (login, url, ended) = ClaudeLogin::start(&folder.env()).await.unwrap();
		assert_eq!(url, LINK);
		assert_eq!(folder.read("args"), "auth login --claudeai\n");
		assert_eq!(login.send_code(" \n").await, Err("The code is one line of text.".into()));
		login.send_code("  abc#123  ").await.unwrap();
		assert_eq!(ended.await.unwrap(), Ok(()));
		assert_eq!(folder.read("code"), "abc#123\n");
	}

	#[tokio::test]
	async fn a_sign_in_that_fails_says_how_it_ended() {
		let folder = Folder::new("fails", "read -r code\necho 'OAuth login failed: invalid code' >&2\nexit 1\n");
		let (login, _, ended) = ClaudeLogin::start(&folder.env()).await.unwrap();
		login.send_code("wrong").await.unwrap();
		let why = ended.await.unwrap().unwrap_err();
		assert!(why.starts_with("claude auth login ended with exit status: 1"), "{why}");
	}

	#[tokio::test]
	async fn cancel_ends_the_child_by_its_own_process() {
		let folder = Folder::new("cancel", "sleep 30\n");
		let (login, _, ended) = ClaudeLogin::start(&folder.env()).await.unwrap();
		let pid = folder.read("pid").trim().parse::<i32>().unwrap();
		let alive = || rustix::process::test_kill_process(rustix::process::Pid::from_raw(pid).unwrap()).is_ok();
		assert!(alive());
		login.cancel();
		assert_eq!(ended.await.unwrap(), Err("the sign-in was cancelled".into()));
		let gone = clock::within(5_000, async {
			while alive() {
				clock::sleep(20).await;
			}
		});
		assert!(gone.await.is_some(), "the stand-in ended");
	}

	#[tokio::test]
	async fn a_claude_that_ends_before_its_link_says_so() {
		let none = AgentEnv::fixed(vec![(OsString::from("PATH"), OsString::from("/nonexistent-gs"))]);
		assert_eq!(ClaudeLogin::start(&none).await.err(), Some(NO_CLAUDE.to_owned()));
		let folder = Folder::with_script("no-link", "echo 'Not available'\nexit 2\n");
		let why = ClaudeLogin::start(&folder.env()).await.err().unwrap();
		assert!(why.starts_with("claude auth login ended with exit status: 2"), "{why}");
	}
}
