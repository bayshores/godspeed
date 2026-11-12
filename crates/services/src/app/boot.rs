//! GET /api/boot: what the window reads on each page load before its first paint. Asking also
//! does what a page load does: it decides onboarding and makes the MCP token, records the version
//! for "What's new", refreshes the godspeed folder (once per start) and uses up this server's
//! welcome screen.

use std::sync::Arc;

use gs_base::config::VERSION;
use gs_json::{Json, json};

use super::agent_folder::{folder_notice_agent, refresh_agent_folder};
use super::onboarding::onboarding_needed;
use super::welcome::first_load_screen;
use super::whats_new::whats_new_since;
use crate::App;

pub fn boot_info(app: &Arc<App>) -> Json {
	// An unwritable data folder shows the app; /api/mcp retries the token.
	let onboarding = onboarding_needed(app).unwrap_or(false);
	// Decided after onboarding, which marks existing users. Unwritable: skip the notes this launch.
	let whats_new = whats_new_since(app, VERSION).unwrap_or(None);
	refresh_agent_folder(app);
	// The move notice waits for a launch without onboarding or "What's new".
	let folder_notice = if !onboarding && whats_new.is_none() { folder_notice_agent(app) } else { None };
	// Asked even during onboarding, so finishing it doesn't open the welcome screen right after
	// "You're all set".
	let first_load = first_load_screen(app);
	let mut boot = json!({
		"onboarding": onboarding,
		"firstLoad": first_load,
		"whatsNewSince": whats_new,
		"folderNotice": folder_notice,
		"activeSpace": null,
		"sounds": true,
	});
	// Unreadable settings: No space.
	if let (Ok(record), Some(fields)) = (app.stores.settings.read_settings(), boot.as_obj_mut()) {
		let general = record.as_ref().map_or(Json::Null, |r| r["general"].clone());
		// A space deleted behind the app's back falls back to No space.
		let active = general["activeSpace"].as_str().filter(|id| !id.is_empty() && *id != "none" && app.stores.spaces.get_space(id).is_some());
		fields.insert("activeSpace", active);
		fields.insert("spaces", app.stores.spaces.list_spaces());
		if let Some(name) = general.get("teacherName") {
			fields.insert("teacherName", name.clone());
		}
		fields.insert("sounds", general["sounds"].as_bool() != Some(false));
	}
	boot
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_first_launch_boots_into_onboarding_and_welcomes_once() {
		let root = scratch_dir("boot-first");
		let app = test_app(&root);
		let first = boot_info(&app);
		assert_eq!(first["onboarding"].as_bool(), Some(true));
		assert_eq!(first["firstLoad"].as_str(), Some("welcome"));
		assert_eq!(first["whatsNewSince"], Json::Null);
		assert_eq!(stringify(&first["spaces"]), "[]");
		assert_eq!(first["sounds"].as_bool(), Some(true));
		assert!(first.get("teacherName").is_none());
		let again = boot_info(&app);
		assert_eq!(again["firstLoad"], Json::Null);
		assert_eq!(again["onboarding"].as_bool(), Some(true));
	}

	#[test]
	fn the_answer_keeps_the_keys_in_order_and_reads_the_learners_choices() {
		let root = scratch_dir("boot-general");
		let app = test_app(&root);
		app.stores.settings.write_settings(&json!({ "version": 2, "general": { "onboarded": true, "lastSeenVersion": VERSION, "teacherName": "Zed", "sounds": false, "activeSpace": "cls_gone" } })).unwrap();
		let boot = boot_info(&app);
		assert_eq!(boot.as_obj().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), ["onboarding", "firstLoad", "whatsNewSince", "folderNotice", "activeSpace", "sounds", "spaces", "teacherName"]);
		assert_eq!(boot["activeSpace"], Json::Null);
		assert_eq!(boot["teacherName"].as_str(), Some("Zed"));
		assert_eq!(boot["sounds"].as_bool(), Some(false));
	}
}
