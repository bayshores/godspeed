//! The teacher's round of work (Follow's slip) as a teacher panel chat's turn feeds it: the turn
//! began, a step its desk shows, the turn ended. The round is kept in the terminal state for now,
//! beside its other sources (the agent in godspeed's terminal, an agent outside godspeed); the chat
//! code calls only these, so the round can move out of the terminal state without changing it.

use gs_core::session::teacher_steps::TeacherStep;

use crate::App;

pub(crate) fn chat_turn_began(app: &App, chat_id: &str, now: i64) {
	app.terminals.talk_began(chat_id, now);
}

pub(crate) fn chat_step(app: &App, chat_id: &str, step: TeacherStep, now: i64) {
	app.terminals.talk_step(chat_id, step, now);
}

pub(crate) fn chat_turn_ended(app: &App, chat_id: &str) {
	app.terminals.talk_ended(chat_id);
}
