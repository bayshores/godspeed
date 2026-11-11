//! App updates. Status `disabled`: nothing is checked, downloaded or installed yet.

use tauri::AppHandle;

/// A check the learner asked for (menu, Settings).
pub fn manual_check(_app: &AppHandle) {}

/// Installs a downloaded update once the server has stopped; `restart_requested` relaunches
/// the app after it.
pub fn install_held(_app: &AppHandle, _restart_requested: bool) {}
