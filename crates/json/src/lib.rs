//! JSON exactly as Node reads and writes it: `JSON.parse` acceptance, `JSON.stringify` output
//! (key order, number text, escapes, tab indent), and lone surrogates kept through a round trip.

pub mod js_text;
pub mod lone;
mod object;
mod parse;
pub mod serde_bridge;
mod value;
mod write;

pub use object::Obj;
pub use parse::{ParseError, parse};
pub use serde_bridge::{from_json, to_json};
pub use value::Json;
pub use write::{js_number, number_text, quote, stringify, stringify_pretty};

#[doc(hidden)]
pub use serde_json as __serde_json;
