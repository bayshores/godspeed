//! The background jobs: the job runner, the researcher, the PDF
//! reader, the demo builder, the visual maker, the cheat sheet writer, the mock writer, a plugin's ask, and what
//! they share (the job-agent runner, one raw model call, job aborts, the background-model
//! permits and the headless checks).

pub mod aborts;
pub mod bg_llm_semaphore;
pub mod cheat_sheet_writer;
pub mod deadline_request;
pub mod demo_builder;
pub mod headless;
pub mod mock_writer;
pub mod pdf_reader;
pub mod pi_run;
pub mod plugin_asker;
pub mod researcher;
pub mod runner;
pub mod stream_once;
pub mod visual_maker;

#[cfg(test)]
mod test_support;

/// A tool declaration for a job loop that runs its tools itself, so it carries no execute.
fn declare(name: &str, description: &str, parameters: gs_json::Json) -> gs_json::Json {
	gs_json::json!({ "name": name, "description": description, "parameters": parameters })
}
