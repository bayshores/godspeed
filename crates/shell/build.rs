//! Tauri's build step: the config, the boot page, the icons and the permission for each app
//! command (`allow-<name>` in capabilities/).

fn main() {
	let commands = tauri_build::AppManifest::new().commands(&[
		"show_window",
		"expand_window",
		"start_drag",
		"toggle_menu",
		"get_zoom",
		"set_zoom",
		"zoom_step",
		"zoom_reset",
	]);
	tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands)).expect("tauri build step");
}
