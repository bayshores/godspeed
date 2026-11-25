//! The background jobs: the job runner, the researcher, the PDF reader, the demo builder, the
//! cheat sheet writer, the mock writer, a plugin's ask, and what they share (the job agent and its
//! runner, job aborts, the pool's permits and the headless checks).

pub mod aborts;
pub mod bg_llm_semaphore;
pub mod cheat_sheet_writer;
pub mod deadline_request;
pub mod demo_builder;
pub mod headless;
pub mod job_agent;
pub mod mock_writer;
pub mod pdf_reader;
pub mod pi_run;
pub mod plugin_asker;
pub mod researcher;
pub mod runner;

#[cfg(test)]
pub(crate) mod test_support;
