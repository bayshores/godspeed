//! A started agent's two pipes, read and written one line at a time.

use gs_base::{clock, tasks};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::process::AgentProcess;

/// What a start gives: the agent's output, its input and, for a real program, the process, which
/// ends with the connection.
pub struct Started {
	pub reader: Box<dyn AsyncRead + Send + Unpin>,
	pub writer: Box<dyn AsyncWrite + Send + Unpin>,
	pub process: Option<AgentProcess>,
}

/// Writes each line sent on the returned channel. It stops when the channel closes or a write
/// fails; the reader then sees the agent go.
pub fn writer(label: &'static str, mut writer: Box<dyn AsyncWrite + Send + Unpin>) -> mpsc::UnboundedSender<String> {
	let (tx, mut rx) = mpsc::unbounded_channel::<String>();
	tasks::detach(label, async move {
		while let Some(mut line) = rx.recv().await {
			line.push('\n');
			if let Err(err) = async {
				writer.write_all(line.as_bytes()).await?;
				writer.flush().await
			}
			.await
			{
				eprintln!("[{label}] cannot write to the agent: {err}");
				return;
			}
		}
	});
	tx
}

/// Gives each line the agent writes to `each` until it closes its output, then says why it went.
pub async fn read(reader: Box<dyn AsyncRead + Send + Unpin>, process: Option<AgentProcess>, mut each: impl FnMut(String)) -> String {
	let mut lines = BufReader::new(reader).lines();
	let closed = loop {
		match lines.next_line().await {
			Ok(Some(line)) if line.trim().is_empty() => {}
			Ok(Some(line)) => each(line),
			Ok(None) => break "it closed its output".to_owned(),
			Err(err) => break format!("its output could not be read: {err}"),
		}
	};
	let Some(mut process) = process else { return closed };
	// A program that closed its output but runs on is ended when `process` drops.
	match clock::within(EXIT_WAIT_MS, process.ended()).await {
		Some(how) => format!("{closed} and ended ({how})"),
		None => format!("{closed} but kept running"),
	}
}

const EXIT_WAIT_MS: i64 = 2_000;

/// The task that reads a connection; dropping the connection stops it, which drops the process.
pub struct Reader(pub JoinHandle<()>);

impl Drop for Reader {
	fn drop(&mut self) {
		self.0.abort();
	}
}
