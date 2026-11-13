//! POST /api/chats/{id}/review: questions from earlier. `next` answers `{question}` (null when none
//! shows), `answer` and `skip` answer `{ok: true}`; 404 for an unknown lesson, 400 for a malformed
//! input, an answer that is not a graded quiz answer or a question that is not the open one, also
//! during a turn, which never makes it 409.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, ids, time};
use gs_json::{Json, json, parse, stringify};
use gs_server::http::access::Access;
use gs_services::App;
use gs_services::turns::turn_liveness::{begin_turn, end_turn};
use gs_store::graph::Ledger;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

async fn serve() -> (Arc<App>, u16) {
	let dir = std::env::temp_dir().join(format!("gs-review-{}", ids::uuid()));
	std::fs::create_dir_all(dir.join("data")).unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir), None);
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	tokio::spawn(axum::serve(listener, gs_server::http::server(app.clone(), &Access::default())).into_future());
	(app, port)
}

/// The status and JSON body of a POST.
async fn post(port: u16, path: &str, body: &Json) -> (u16, Json) {
	let body = stringify(body);
	let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
	let head = format!("POST {path} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n", body.len());
	conn.write_all(format!("{head}{body}").as_bytes()).await.unwrap();
	let mut got = String::new();
	conn.read_to_string(&mut got).await.unwrap();
	let (head, body) = got.split_once("\r\n\r\n").unwrap();
	(head[9..12].parse().unwrap(), parse(body).unwrap())
}

/// A space whose earlier lesson stored a question from earlier on Bayes' rule, answered right 10
/// days ago, and a new Study lesson waiting for its first reply.
fn space_with_a_question(app: &App) -> (String, String) {
	let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].as_str().unwrap().to_owned();
	let lesson = |messages: &[Json]| {
		let id = app.stores.chats.create_chat("Study for Midterm", Some("study"), Some(&space_id), None).unwrap()["id"].as_str().unwrap().to_owned();
		app.stores.chats.save_tree(&id, &json!({ "nodes": [{ "id": "reg", "title": "Regularization" }], "edges": [] })).unwrap();
		app.stores.chats.save_messages(&id, messages).unwrap();
		id
	};
	let then = clock::now_ms() - 10 * 86_400_000;
	let quiz = json!({ "type": "check", "nodeId": "bayes", "question": "How likely?", "options": [{ "label": "About 25%" }, { "label": "About 60%" }], "explanation": "A quarter.", "correctAnswer": "About 25%" });
	let right = json!({ "kind": "quiz", "correct": true, "answers": [{ "index": 1, "label": "About 25%" }], "answeredAt": time::iso(then) });
	let earlier = lesson(&[
		json!({ "role": "assistant", "id": "m1", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": quiz }], "timestamp": then }),
		json!({ "role": "toolResult", "toolCallId": "q1", "toolName": "quiz", "details": right, "isError": false, "timestamp": then }),
		json!({ "role": "assistant", "id": "m2", "content": [{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": "bayes", "review": quiz } }], "timestamp": then }),
		json!({ "role": "toolResult", "toolCallId": "t1", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1 }, "isError": false, "timestamp": then }),
	]);
	let fact = json!({ "id": "f_bayes", "name": "Bayes' rule", "statement": "Bayes' rule", "createdAt": time::iso(then), "aliases": [], "provenance": [{ "chatId": earlier, "messageId": "m1" }] });
	app.stores.graphs.append(Some(&space_id), Ledger::Nodes, &fact).unwrap();
	app.stores.graphs.append(Some(&space_id), Ledger::Topics, &json!({ "at": time::iso(then), "topics": [{ "id": "bayes", "name": "Bayes' rule", "members": ["f_bayes"] }] })).unwrap();
	let now = lesson(&[json!({ "role": "user", "id": "u1", "content": "Study for Midterm", "timestamp": clock::now_ms() })]);
	(earlier, now)
}

#[tokio::test]
async fn review_answers_each_case() {
	let (app, port) = serve().await;
	let (earlier, chat_id) = space_with_a_question(&app);
	let path = format!("/api/chats/{chat_id}/review");
	let of = json!({ "chatId": earlier, "toolCallId": "t1" });
	let right = json!({ "kind": "quiz", "dontKnow": false, "correct": true, "answers": [{ "index": 1, "label": "About 25%" }], "confidence": 80 });

	assert_eq!(post(port, "/api/chats/chat_gone/review", &json!({ "input": { "type": "next" } })).await, (404, json!({ "error": "Unknown chat" })));
	let malformed = json!({ "error": "input must be { type: \"next\" }, { type: \"answer\", of, answer } or { type: \"skip\", of }" });
	for input in [json!({}), json!({ "type": "answer", "of": of }), json!({ "type": "skip", "of": { "chatId": earlier } }), json!({ "type": "dismiss" })] {
		assert_eq!(post(port, &path, &json!({ "input": input })).await, (400, malformed.clone()), "{input:?}");
	}
	let (status, body) = post(port, &path, &json!({ "input": { "type": "next" } })).await;
	assert_eq!(status, 200);
	assert_eq!(body["question"]["of"], json!({ "chatId": earlier, "messageId": "m2", "toolCallId": "t1" }));
	assert_eq!((body["question"]["topic"].as_str(), body["question"]["quiz"]["correctAnswer"].as_str()), (Some("Bayes' rule"), Some("About 25%")));

	assert!(begin_turn(&app, &chat_id));
	let not_open = json!({ "input": { "type": "answer", "of": { "chatId": earlier, "toolCallId": "q1" }, "answer": right } });
	assert_eq!(post(port, &path, &not_open).await, (400, json!({ "error": "That question from earlier is not open" })), "during a turn: 400, never 409");
	let unpicked = json!({ "input": { "type": "answer", "of": of, "answer": { "kind": "quiz", "answers": [] } } });
	assert_eq!(post(port, &path, &unpicked).await, (400, json!({ "error": "An answer is a graded quiz answer with a pick, or I don't know" })));
	assert_eq!(post(port, &path, &json!({ "input": { "type": "skip", "of": of } })).await, (200, json!({ "ok": true })));
	assert_eq!(post(port, &path, &json!({ "input": { "type": "next" } })).await, (200, json!({ "question": null })), "skipped: nothing else is due");
	end_turn(&app, &chat_id);

	let (_, fresh) = space_with_a_question(&app);
	let fresh_path = format!("/api/chats/{fresh}/review");
	let (_, body) = post(port, &fresh_path, &json!({ "input": { "type": "next" } })).await;
	let of = body["question"]["of"].clone();
	assert_eq!(post(port, &fresh_path, &json!({ "input": { "type": "answer", "of": of, "answer": right } })).await, (200, json!({ "ok": true })));
	let record = app.stores.chats.get_chat(&fresh).unwrap();
	let marker = record["messages"].as_arr().unwrap().last().unwrap().clone();
	assert_eq!((marker["customType"].as_str(), marker["details"]["topic"].as_str()), (Some("review"), Some("Bayes' rule")));
	assert_eq!(post(port, &fresh_path, &json!({ "input": { "type": "next" } })).await, (200, json!({ "question": null })), "answered today");
}
