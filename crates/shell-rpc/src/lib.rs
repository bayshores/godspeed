//! The line protocol between the desktop shell and godspeed-server: one JSON object per line on
//! the server's stdin (shell to server) and stdout (server to shell), `t` naming the message.

mod lines;
mod link;
mod login;
mod messages;

pub use lines::{read_lines, write_line};
pub use link::ShellLink;
pub use login::same_bytes;
pub use messages::{DemoOutcome, DemoResult, SvgOutcome, ToServer, ToShell};
