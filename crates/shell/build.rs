//! Tauri's build step: the config, the boot page, the icons and the permission for each app
//! command (`allow-<name>` in capabilities/).

fn main() {
	let commands = tauri_build::AppManifest::new().commands(&[
		"show_window",
		"start_drag",
		"toggle_menu",
		"open_link",
		"get_zoom",
		"set_zoom",
		"zoom_step",
		"zoom_reset",
		"update_state",
		"update_check",
		"update_install",
		"pick_folder",
		"show_in_folder",
		"open_path",
		"open_agent",
		"terminal_start",
		"terminal_attach",
		"terminal_detach",
		"terminal_write",
		"terminal_answer",
		"terminal_paste",
		"terminal_stop",
		"terminal_list",
		"report_bug",
		"list_fonts",
		"print_pdf",
		"drag_paths",
		"title_bar_double_click",
	]);
	tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands)).expect("tauri build step");
}
