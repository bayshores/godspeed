//! Requests get their answers by id, and logins are answered on the same stream.

use std::io::{self, Write};

use gs_base::clock;
use gs_shell_rpc::{DemoOutcome, DemoResult, ShellLink, SvgOutcome, ToServer, ToShell, read_lines};
use tokio::sync::mpsc;

/// Hands each written line to the test.
struct Lines(mpsc::UnboundedSender<Vec<u8>>);

impl Write for Lines {
	fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
		let _ = self.0.send(buf.to_vec());
		Ok(buf.len())
	}

	fn flush(&mut self) -> io::Result<()> {
		Ok(())
	}
}

fn link() -> (ShellLink, mpsc::UnboundedReceiver<Vec<u8>>) {
	let (tx, rx) = mpsc::unbounded_channel();
	(ShellLink::new(Lines(tx)), rx)
}

async fn sent(rx: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> ToShell {
	let line = rx.recv().await.expect("a line");
	assert_eq!(line.last(), Some(&b'\n'));
	read_lines(&line[..]).next().expect("one message").expect("a known message")
}

#[tokio::test]
async fn requests_get_their_own_answers() {
	let (link, mut rx) = link();
	let demo = tokio::spawn({
		let link = link.clone();
		async move { link.demo("<p>hi</p>", None).await }
	});
	let ToShell::Demo { id: demo_id, html, probe } = sent(&mut rx).await else { panic!("a demo request") };
	assert_eq!((demo_id, html.as_str(), probe), (1, "<p>hi</p>", None));

	let svg = tokio::spawn({
		let link = link.clone();
		async move { link.svg("<svg/>", 9, 7).await }
	});
	let ToShell::Svg { id: svg_id, svg: drawing, width, height } = sent(&mut rx).await else { panic!("an svg request") };
	assert_eq!((svg_id, drawing.as_str(), width, height), (2, "<svg/>", 9, 7));

	// Answers in the other order, plus one for an id nobody waits for.
	link.receive(ToServer::SvgDone { id: 99, outcome: SvgOutcome::Png("late".into()) });
	link.receive(ToServer::SvgDone { id: svg_id, outcome: SvgOutcome::Error("no view".into()) });
	let result = DemoResult { ok: true, ..DemoResult::default() };
	link.receive(ToServer::DemoDone { id: demo_id, outcome: DemoOutcome::Result(result.clone()) });
	assert_eq!(svg.await.unwrap(), Err("no view".to_owned()));
	assert_eq!(demo.await.unwrap(), Ok(result));
}

#[tokio::test]
async fn a_notification_answers_whether_it_went_to_the_system() {
	let (link, mut rx) = link();
	let shown = tokio::spawn({
		let link = link.clone();
		async move { link.notify("Quiz 2 is tomorrow", "Algebra.").await }
	});
	let ToShell::Notify { id, title, body } = sent(&mut rx).await else { panic!("a notify request") };
	assert_eq!((title.as_str(), body.as_str()), ("Quiz 2 is tomorrow", "Algebra."));
	link.receive(ToServer::NotifyDone { id, shown: false });
	assert_eq!(shown.await.unwrap(), Ok(false));
}

#[tokio::test]
async fn an_answer_of_the_wrong_kind_is_skipped() {
	let (link, mut rx) = link();
	let demo = tokio::spawn({
		let link = link.clone();
		async move { link.demo("<p>hi</p>", None).await }
	});
	let ToShell::Demo { id, .. } = sent(&mut rx).await else { panic!("a demo request") };
	link.receive(ToServer::SvgDone { id, outcome: SvgOutcome::Png("png".into()) });
	clock::sleep(50).await;
	assert!(!demo.is_finished(), "the demo still waits for its own answer");
	link.receive(ToServer::DemoDone { id, outcome: DemoOutcome::Error("no view".into()) });
	assert_eq!(demo.await.unwrap(), Err("no view".to_owned()));
}

#[tokio::test]
async fn logins_are_answered_and_bad_lines_skipped() {
	let (link, mut rx) = link();
	let token = "0123456789abcdef".repeat(4);
	let input = format!("not json\n{{\"t\":\"login\",\"id\":5,\"token\":\"{token}\"}}\n{{\"t\":\"login\",\"id\":6,\"token\":\"short\"}}\n");
	link.listen(input.as_bytes());
	assert_eq!(sent(&mut rx).await, ToShell::LoginOk { id: 5 });
	assert!(rx.try_recv().is_err(), "a bad token gets no login_ok");
	assert!(!link.take_login(&"f".repeat(64)));
	assert!(link.take_login(&token));
	assert!(!link.take_login(&token), "a token works once");
}
