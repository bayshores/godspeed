//! Who takes a background job, on the app clock: one the learner asked for goes to the teacher,
//! and to a helper only once it waited untaken 20 s; godspeed's own goes to a helper, and to a
//! teacher alone only once it waited 60 s; one an open lesson waits on goes before godspeed's
//! own. One test, because the clock is shared by the whole binary.

use std::sync::Arc;

use gs_base::clock;
use gs_base::events::Events;
use gs_engine::bridge::{AgentReply, Bridge, WaitOptions};
use gs_engine::turn::abort::Abort;
use gs_json::{Json, json};

mod common;
use common::{Marks, park};

fn user(text: &str) -> Json {
	json!({ "role": "user", "content": text, "timestamp": 1 })
}

fn teacher() -> WaitOptions {
	WaitOptions { agent: Some("main-1".to_owned()), and_others: true, ..WaitOptions::default() }
}

fn helper() -> WaitOptions {
	WaitOptions { agent: Some("helper-1".to_owned()), helper: true, ..WaitOptions::default() }
}

fn reply(text: &str) -> AgentReply {
	AgentReply { text: Some(text.to_owned()), tool_calls: Vec::new() }
}

/// Lets spawned tasks reach their next timer before the clock jumps.
async fn settle() {
	clock::sleep(5).await;
}

#[tokio::test]
async fn asked_jobs_go_to_the_teacher_and_godspeeds_own_to_the_helper() {
	let bridge = Bridge::new(&Events::new(), Arc::new(Marks::default()));

	// godspeed's own job and no helper yet: the teacher leaves it 60 s, time for one to start.
	let own = park(&bridge, vec![user("read this file")], "job_read", &Abort::new());
	settle().await;
	assert_eq!(bridge.helper_work_count(clock::now_ms()), 1, "the window starts a helper for it");
	assert!(bridge.wait_for_work(0, teacher()).await.is_none());
	clock::advance(60_000);
	let work = bridge.wait_for_work(0, teacher()).await.unwrap();
	assert_eq!(work.conversation, "job_read", "no helper came, so the teacher takes it");
	assert_eq!(bridge.helper_work_count(clock::now_ms()), 0, "taken");
	bridge.respond_to_work(&work.work_id, reply("Read."), 0).unwrap();
	own.await.unwrap();

	// What the learner asked for goes to the teacher, even with a helper here.
	bridge.mark_asked("job_ask");
	let ask = park(&bridge, vec![user("what does HW6 cover")], "job_ask", &Abort::new());
	settle().await;
	assert!(bridge.wait_for_work(0, helper()).await.is_none(), "the helper leaves it to the teacher");
	assert_eq!(bridge.helper_work_count(clock::now_ms()), 0);
	let work = bridge.wait_for_work(0, teacher()).await.unwrap();
	assert_eq!(work.conversation, "job_ask");
	bridge.respond_to_work(&work.work_id, reply("Linked."), 0).unwrap();
	ask.await.unwrap();

	// Left untaken 20 s (the teacher is busy), it becomes the helper's.
	bridge.mark_asked("job_ask_2");
	let ask = park(&bridge, vec![user("what does HW7 cover")], "job_ask_2", &Abort::new());
	settle().await;
	clock::advance(20_000);
	assert_eq!(bridge.helper_work_count(clock::now_ms()), 1);
	let work = bridge.wait_for_work(0, helper()).await.unwrap();
	assert_eq!(work.conversation, "job_ask_2");
	bridge.respond_to_work(&work.work_id, reply("Linked."), 0).unwrap();
	ask.await.unwrap();

	// With a helper here, the teacher leaves godspeed's own jobs to it however long they wait.
	let own = park(&bridge, vec![user("group these")], "job_topics", &Abort::new());
	settle().await;
	clock::advance(60_000);
	assert!(bridge.wait_for_work(0, teacher()).await.is_none());
	let work = bridge.wait_for_work(0, helper()).await.unwrap();
	assert_eq!(work.conversation, "job_topics");
	bridge.respond_to_work(&work.work_id, reply("Grouped."), 0).unwrap();
	own.await.unwrap();

	// A job an open lesson waits on is taken before godspeed's own, however long that one waited.
	let own = park(&bridge, vec![user("check this space")], "job_check", &Abort::new());
	settle().await;
	clock::advance(30_000);
	bridge.mark_awaited("job_pdf");
	let awaited = park(&bridge, vec![user("read HW7.pdf")], "job_pdf", &Abort::new());
	settle().await;
	let work = bridge.wait_for_work(0, helper()).await.unwrap();
	assert_eq!(work.conversation, "job_pdf");
	bridge.respond_to_work(&work.work_id, reply("Read."), 0).unwrap();
	awaited.await.unwrap();
	let work = bridge.wait_for_work(0, helper()).await.unwrap();
	assert_eq!(work.conversation, "job_check");
	bridge.respond_to_work(&work.work_id, reply("Checked."), 0).unwrap();
	own.await.unwrap();
}
