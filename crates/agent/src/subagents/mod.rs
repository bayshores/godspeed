//! The background jobs: the job runner, the researcher, the PDF
//! reader, the demo builder, the visual maker, the cheat sheet writer, the prep sheet writer, and
//! what they share (the helper-agent runner, one raw model call, job aborts, the background-model
//! permits and the headless checks).

pub mod aborts;
pub mod bg_llm_semaphore;
pub mod cheat_sheet_writer;
pub mod demo_builder;
pub mod headless;
pub mod mock_writer;
pub mod pdf_reader;
pub mod pi_run;
pub mod prep_writer;
pub mod researcher;
pub mod runner;
pub mod stream_once;
pub mod visual_maker;

#[cfg(test)]
mod test_support;
