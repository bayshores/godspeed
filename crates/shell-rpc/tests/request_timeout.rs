//! A request the shell never answers ends after 60 s by the app clock (its own test binary: it
//! moves the clock).

use gs_base::clock;
use gs_shell_rpc::{ShellLink, ToShell};

#[tokio::test]
async fn an_unanswered_request_times_out() {
	let link = ShellLink::new(std::io::sink());
	let waiting = tokio::spawn({
		let link = link.clone();
		async move { link.request(|id| ToShell::Demo { id, html: String::new(), probe: None }).await }
	});
	// Lets the request start its 60 s wait before the clock jumps.
	clock::sleep(50).await;
	assert!(!waiting.is_finished());
	clock::advance(60_000);
	assert_eq!(waiting.await.unwrap(), Err("demo check timed out".to_owned()));
}
