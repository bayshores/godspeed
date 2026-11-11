//! Recordings to captions with brew's ffmpeg and whisper-cli, and the speech model download.

mod exec;
pub mod model;
pub mod programs;
pub mod run;

#[cfg(all(test, unix))]
mod model_tests;
#[cfg(all(test, unix))]
mod run_tests;
#[cfg(all(test, unix))]
mod test_support;
