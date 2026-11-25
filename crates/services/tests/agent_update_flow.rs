//! Updating Claude Code from the setup card, on a stand-in `claude` that keeps its version in a
//! file its `update` rewrites: one update at a time, each line told, a finished update checked
//! again, a failure kept with the command until a check finds the agent new enough, and the 10
//! minutes running out. One test, since it moves the app clock.
#![cfg(unix)]

mod agent_stand_ins;

use std::path::Path;

use gs_base::events::EventKind;
use gs_base::{clock, fsx};
use gs_json::{Json, stringify};
use gs_services::app::agent_health::check_health;
use gs_services::app::agent_update::start_update;

use agent_stand_ins::{MAX, alive, app, ended, folder, program, view_when};

/// `claude` saying the version in `version` and signed in on Max. Its `update` does what the
/// word in `mode` says: `ok` waits for a `go` file then updates, `fail` fails, `hang` never ends.
/// Each update started adds a line to `starts` and keeps its PID in `pid`.
fn stand_ins(dir: &Path) {
	fsx::write_text_atomic(&dir.join("version"), "2.1.327\n").unwrap();
	let update = r#"echo started >> "$dir/starts"; echo $$ > "$dir/pid"
case "$(cat "$dir/mode")" in
ok) echo 'Current version: 2.1.327'; while [ ! -f "$dir/go" ]; do sleep 0.02; done; echo 2.1.340 > "$dir/version"; echo 'Successfully updated from 2.1.327 to version 2.1.340' ;;
fail) echo 'Checking for updates...'; echo 'Error: EACCES: permission denied' >&2; exit 1 ;;
hang) sleep 1000 ;;
esac"#;
	program(dir, "claude", &format!("case \"$1\" in\n--version) echo \"$(cat \"$dir/version\") (Claude Code)\" ;;\nauth) cat <<'EOF'\n{MAX}\nEOF\n;;\nupdate) {update} ;;\nesac\n"));
}

fn up_to_date(view: &Json) -> (&str, &str) {
	let row = view["checks"].items().iter().find(|check| check["check"].as_str() == Some("upToDate")).unwrap();
	(row["state"].str_or_empty(), view["checks"][0]["fact"].str_or_empty())
}

#[tokio::test(flavor = "multi_thread")]
async fn claude_code_updates_from_the_card_one_update_at_a_time() {
	let dir = folder("agent-update");
	stand_ins(&dir);
	let app = app(&dir);
	let mode = |word: &str| fsx::write_text_atomic(&dir.join("mode"), word).unwrap();
	let read = |name: &str| std::fs::read_to_string(dir.join(name)).unwrap_or_default();
	let view = view_when(&app, |view| view["checking"] == Json::Bool(false)).await;
	assert_eq!((up_to_date(&view), view["failing"]["problem"].as_str()), (("failed", "2.1.327"), Some("tooOld")));
	let mut events = app.events.subscribe();

	// One update at a time: a second start gives the running one.
	mode("ok");
	let running = r#"{"state":"running","line":null,"command":"claude update"}"#;
	assert_eq!(stringify(&start_update(&app).await.unwrap()), running);
	view_when(&app, |view| view["update"]["line"].as_str() == Some("Current version: 2.1.327")).await;
	assert_eq!(start_update(&app).await.unwrap()["state"].as_str(), Some("running"));
	assert_eq!(read("starts"), "started\n");

	// It finishes, tells so, and the check finds the new version.
	fsx::write_text_atomic(&dir.join("go"), "").unwrap();
	let view = view_when(&app, |view| up_to_date(view).0 == "passed" && view["checking"] == Json::Bool(false)).await;
	assert_eq!((up_to_date(&view).1, view["update"].clone(), view["failing"].clone()), ("2.1.340", Json::Null, Json::Null));
	let told: Vec<String> = std::iter::from_fn(|| events.try_recv().ok()).filter(|event| event.kind == EventKind::AgentUpdate).map(|event| stringify(&event.payload)).collect();
	assert_eq!(
		told,
		[
			running,
			r#"{"state":"running","line":"Current version: 2.1.327","command":"claude update"}"#,
			r#"{"state":"running","line":"Successfully updated from 2.1.327 to version 2.1.340","command":"claude update"}"#,
			r#"{"state":"done","line":"Successfully updated from 2.1.327 to version 2.1.340","command":"claude update"}"#,
		]
	);

	// A failure stays on the card with its error line and the command, until a check finds the
	// agent new enough.
	fsx::write_text_atomic(&dir.join("version"), "2.1.327\n").unwrap();
	mode("fail");
	start_update(&app).await.unwrap();
	let view = view_when(&app, |view| view["update"]["state"].as_str() == Some("failed")).await;
	assert_eq!(stringify(&view["update"]), r#"{"state":"failed","line":"Error: EACCES: permission denied","command":"claude update"}"#);
	fsx::write_text_atomic(&dir.join("version"), "2.1.340\n").unwrap();
	check_health(&app);
	view_when(&app, |view| view["update"] == Json::Null).await;

	// Ten minutes with no end stop it by its own PID.
	fsx::write_text_atomic(&dir.join("version"), "2.1.327\n").unwrap();
	mode("hang");
	start_update(&app).await.unwrap();
	let pid = loop {
		let pid = read("pid");
		if read("starts").lines().count() == 3 && alive(&pid) {
			break pid;
		}
		clock::sleep(10).await;
	};
	clock::advance(10 * 60_000 + 1_000);
	let view = view_when(&app, |view| view["update"]["state"].as_str() == Some("failed")).await;
	assert_eq!(view["update"]["line"].as_str(), Some("the update didn't finish within 10 minutes"));
	assert!(ended(&pid).await, "the update's process ended");
	let _ = std::fs::remove_dir_all(&dir);
}
