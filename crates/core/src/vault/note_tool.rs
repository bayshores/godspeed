//! The limits of the two vault tools, shared by the outside agent's schema, the lesson tool and
//! the server's checks.

pub const TITLE_MAX: usize = 80;
pub const TEXT_MAX: usize = 1_200;
pub const RECALL_MAX: usize = 200;
pub const MISTAKE_TEXT_MAX: usize = 160;
pub const MISTAKE_KIND_MAX: usize = 30;
pub const LINKS_MAX: usize = 6;
pub const SEARCH_DEFAULT_LIMIT: usize = 8;
pub const SEARCH_MAX_LIMIT: usize = 30;
/// A whole note read with `path` is cut here.
pub const WHOLE_NOTE_CHARS: usize = 20_000;
/// Most "My words" asks at one lesson end.
pub const ASKS_MAX: usize = 3;
/// The longest "My words" the learner types.
pub const WORDS_MAX: usize = 600;
