//! THE FILE PIPELINE (spaces.ts): file → text (gs_files, gs_transcribe) → the notes import into
//! the space's own graph. Study files become facts; space info never does. Both go into the
//! space's search index. Work is serialized per space (one queue each): the file list is a
//! read-modify-write record, and one space's imports shouldn't flood the shared extraction slots.


mod indexing;
mod queue;
mod scanner;

pub use queue::enqueue_file;
pub(super) use indexing::reindex_kept_pages;
pub use scanner::{queue_waiting_files, start_space_scanner};
