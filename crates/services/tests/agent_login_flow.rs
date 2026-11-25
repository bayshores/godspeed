//! Signing Claude Code in from the setup card, on stand-in programs that print what the real
//! `claude`, `claude auth login` and `node` print: one sign-in at a time, a code reaching its
//! input, a finished sign-in checked again, a cancel, a failure, and the 5 minutes running out.
//! One test, since it moves the app clock.
#![cfg(unix)]

mod agent_stand_ins;

use std::path::Path;

use gs_base::{clock, fsx};
use gs_json::Json;
use gs_services::app::agent_health::health_view;
use gs_services::app::agent_login::{LoginError, cancel_login, send_login_code, start_login};

use agent_stand_ins::{MAX, alive, app, ended, folder, program, view_when};

const LINK: &str = "https://claude.com/cai/oauth/authorize?code=true&client_id=c&state=s";

const SIGNED_OUT: &str = r#"{ "loggedIn": false, "authMethod": "none", "apiProvider": "firstParty", "loginExpiresAt": null }"#;

/// `claude`: its version, the account in `status`, and a sign-in that takes the code "good",
/// which signs it in. Each sign-in started adds a line to `starts` and keeps its PID in `pid`.
fn stand_ins(dir: &Path) {
	fsx::write_text_atomic(&dir.join("status"), SIGNED_OUT).unwrap();
	let login = format!(
		"echo started >> \"$dir/starts\"\necho $$ > \"$dir/pid\"\nprintf 'Opening browser to sign in…\\nIf the browser didn'\\''t open, visit:\\n{LINK}\\nPaste code here if prompted > '\nread -r code\n[ \"$code\" = good ] || exit 1\ncp \"$dir/max\" \"$dir/status\"\necho 'Login successful.'\n"
	);
	program(dir, "claude", &format!("case \"$1\" in\n--version) echo '2.1.332 (Claude Code)' ;;\nauth) if [ \"$2\" = status ]; then cat \"$dir/status\"; grep -q '\"loggedIn\": true' \"$dir/status\"; exit $?; fi\n{login};;\nesac\n"));
	fsx::write_text_atomic(&dir.join("max"), MAX).unwrap();
}

fn logged_in(view: &Json) -> &Json {
	&view["checks"].items().iter().find(|check| check["check"].as_str() == Some("loggedIn")).unwrap()["state"]
}

#[tokio::test(flavor = "multi_thread")]
async fn claude_code_signs_in_from_the_card_one_sign_in_at_a_time() {
	let dir = folder("agent-login");
	stand_ins(&dir);
	let app = app(&dir);
	let read = |name: &str| std::fs::read_to_string(dir.join(name)).unwrap_or_default();

	let view = view_when(&app, |view| view["checking"] == Json::Bool(false)).await;
	assert_eq!((logged_in(&view).as_str(), view["failing"]["problem"].as_str()), (Some("failed"), Some("signedOut")));
	assert_eq!(send_login_code(&app, "good").await, Err(LoginError::NoLogin));
	assert_eq!(cancel_login(&app).await, Err(LoginError::NoLogin));

	// One sign-in at a time: a second start gives the running one's page.
	assert_eq!(start_login(&app).await, Ok(LINK.to_owned()));
	assert_eq!(start_login(&app).await, Ok(LINK.to_owned()));
	assert_eq!(read("starts"), "started\n");
	assert_eq!(gs_json::stringify(&health_view(&app)["login"]), format!(r#"{{"url":"{LINK}","code":true}}"#));

	// The code goes to its input; it signs in, and the check runs again and finds the plan.
	send_login_code(&app, "good").await.unwrap();
	let view = view_when(&app, |view| logged_in(view).as_str() == Some("passed") && view["checking"] == Json::Bool(false)).await;
	assert_eq!((view["login"].clone(), view["failing"].clone()), (Json::Null, Json::Null));
	assert_eq!(view["checks"][3]["fact"].as_str(), Some("Max plan"));

	// A cancel ends the child by its own PID, and the card shows no sign-in.
	fsx::write_text_atomic(&dir.join("status"), SIGNED_OUT).unwrap();
	start_login(&app).await.unwrap();
	let pid = read("pid");
	assert!(alive(&pid));
	cancel_login(&app).await.unwrap();
	assert_eq!(health_view(&app)["login"], Json::Null);
	assert!(ended(&pid).await, "the cancelled sign-in's claude ended");

	// A wrong code fails it, and the card says why until the next sign-in.
	start_login(&app).await.unwrap();
	send_login_code(&app, "bad").await.unwrap();
	let view = view_when(&app, |view| view["login"]["failed"].as_str().is_some()).await;
	assert!(view["login"]["failed"].str_or_empty().starts_with("claude auth login ended with exit status: 1"), "{}", gs_json::stringify(&view["login"]));

	// Five minutes with no answer end it.
	start_login(&app).await.unwrap();
	assert_eq!(health_view(&app)["login"]["url"].as_str(), Some(LINK));
	clock::advance(5 * 60_000 + 1_000);
	let view = view_when(&app, |view| view["login"]["failed"].as_str().is_some()).await;
	assert_eq!(view["login"]["failed"].as_str(), Some("the sign-in didn't finish within 5 minutes"));
	assert_eq!(read("starts").lines().count(), 4);
	let _ = std::fs::remove_dir_all(&dir);
}
