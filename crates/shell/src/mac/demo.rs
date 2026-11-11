//! The demo runner on the Mac: not available yet.

use gs_shell_rpc::DemoResult;
use tauri::AppHandle;

use crate::demo::{DemoJob, SvgJob};

const NOT_AVAILABLE: &str = "demo checking is not available";

pub fn run(_app: &AppHandle, _job: DemoJob, done: Box<dyn FnOnce(Result<DemoResult, String>) + Send>) {
	done(Err(NOT_AVAILABLE.to_owned()));
}

pub fn svg(_app: &AppHandle, _job: SvgJob, done: Box<dyn FnOnce(Result<Vec<u8>, String>) + Send>) {
	done(Err(NOT_AVAILABLE.to_owned()));
}
