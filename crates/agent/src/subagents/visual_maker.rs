//! The visual job's agent. It writes ONE
//! precise SVG from a brief, renders it to a PNG, looks at the render and iterates until it is
//! right.
//!
//! The loop is hand-rolled over `stream_once` because it must show the model an image after each
//! render: the tools are declared without execute, the model call stops at the tool calls, and
//! this loop adds the tool results itself, then a user message with the PNG.
//!
//! Nothing is delivered unseen: finishing while the current SVG was never rendered (or changed
//! since) renders it anyway, shows it, and asks the model to look first.
//!
//! A failure is `{svg: "", notes: "FAILED: …"}`, like the demo builder's.

use gs_base::ids;
use gs_base::num::to_fixed;
use gs_base::text::{is_js_space, len16, slice16, trim};
use gs_engine::turn::messages::tool_calls;
use gs_json::{Json, json};

use super::pi_run::{HelperOptions, RunError};
use super::stream_once::{message_text, png_message, stream_once, tool_text, user_text};

const INSTRUCTIONS: &str = r#"You are a visual maker — a diagram author + renderer for precise, spatial figures. You
receive a brief describing ONE idea that needs exact placement (coordinate geometry, number lines,
vectors, function plots, physical layouts — things auto-layout diagrams cannot express), and you return
ONE clean, correct SVG. You never see the lesson; the brief is everything you know.

You do NOT decide what idea to show — the teacher already decided. Your job is faithful, precise
composition, and above everything CORRECTNESS: the picture must not assert anything false. A right-angle
mark on the wrong corner, a vector pointing the wrong way, a point plotted at the wrong coordinate is a
failure even if it renders cleanly.

Your three tools:
- write_svg({ svg }) — write the complete <svg>…</svg> source (overwrites the previous version).
- edit_svg({ old_text, new_text }) — a surgical exact-match replacement in the current SVG:
  old_text must appear EXACTLY ONCE; it is replaced by new_text. Call write_svg first. For anything
  beyond a one-spot fix (new elements, restructured layout), write_svg the whole document again.
- render_svg({}) — rasterize the current SVG to a PNG. The render arrives as an image in the
  message right after the tool result.

THE ONE RULE THAT MATTERS MOST: verify by looking. You are done only when you have LOOKED at the
rendered PNG and confirmed it is true to the brief. Rendering success only proves the SVG parsed; it
says nothing about whether the geometry is right or the picture is readable. When you look:

- Is every coordinate, angle, direction, and proportion actually correct? Re-derive the geometry if unsure.
- Are labels placed clearly, not overlapping lines or each other?
- Is anything clipped by the viewBox, too small to read, or cramped?
- Would a learner instantly read the intended idea from this picture alone?

Workflow: plan the coordinate space (viewBox + margins, nothing touching the edges) → write_svg →
render_svg → LOOK critically → fix (edit_svg for one-spot fixes, write_svg otherwise) and re-render
until correct and clean. Never finish without having looked at a render of your FINAL SVG.

SVG requirements:
- A complete <svg> with explicit width/height AND a matching viewBox.
- A <title> first inside it, naming what the figure shows (screen readers read it).
- White background (<rect> or style), dark strokes, sans-serif labels at generous sizes.
- One idea, fewest elements — sparse and large beats busy and tiny.
- Draw only what the brief specifies; never invent data, values, or shapes to fill space.
- Plain, clean styling: at most one accent color. An explanatory diagram, not art.

Your FINAL message: 1-2 sentences of notes for the teacher (what the figure shows, any caveats) —
NEVER the SVG source itself. If you genuinely cannot make a correct picture of the brief, say exactly
that in your final message and why."#;

/// Model rounds: write/render cycles plus the final answer.
const MAX_ITERATIONS: usize = 8;

const LOOK_MESSAGE: &str = "Here is the current render of your SVG — inspect it critically (geometry, labels, clipping, readability):";
const UNLOOKED_FINISH_MESSAGE: &str = "You finished without looking at a render of your final SVG. Above is its render. If it is correct and clean, reply with just your notes; otherwise call write_svg with fixes and render again.";

/// The wire declarations: this loop runs the tools itself, so they carry no execute.
fn visual_tools() -> Vec<Json> {
	vec![
		json!({
			"name": "write_svg",
			"description": "Write the complete SVG source for the figure (overwrites any previous version).",
			"parameters": { "type": "object", "required": ["svg"], "properties": { "svg": { "type": "string", "description": "Complete <svg xmlns=\"…\">…</svg> markup." } } },
		}),
		json!({
			"name": "edit_svg",
			"description": "Replace one exact spot in the current SVG: old_text must appear EXACTLY ONCE and is replaced by new_text. Call write_svg first. For larger changes, write_svg the whole document.",
			"parameters": {
				"type": "object",
				"required": ["old_text", "new_text"],
				"properties": {
					"old_text": { "type": "string", "description": "The exact text to replace — must match exactly once in the current SVG." },
					"new_text": { "type": "string", "description": "The replacement text." },
				},
			},
		}),
		json!({
			"name": "render_svg",
			"description": "Render the current SVG to a PNG and show it to you for inspection. No arguments.",
			"parameters": { "type": "object", "properties": {} },
		}),
	]
}

fn failed(notes: &str) -> Json {
	json!({ "svg": "", "notes": format!("FAILED: {notes}") })
}

/// Makes the figure for `brief`. Never fails: a failure is the failure shape.
pub async fn run_visual_maker(brief: &str, opts: &HelperOptions) -> Json {
	let brief = match trim(brief) {
		"" => "(no brief)",
		b => b,
	};
	if let Some(reason) = opts.headless.unavailable_reason() {
		return failed(&reason);
	}
	let tools = visual_tools();
	let engine = opts.engine();
	let abort = opts.abort();
	let session_id = ids::uuid();
	opts.bridge.label_conversation(&session_id, &format!("Visual: {}", brief.split('\n').next().unwrap_or_default()));
	let prompt = ["Brief for ONE precise figure (from the teacher, verbatim — it is everything you know):", brief, "", "Author the SVG, render it, look at it, iterate until correct, then finish with your notes."].join("\n");

	let mut state = Figure { messages: vec![user_text(&prompt)], current: None, rendered: None, looked: None, final_text: String::new() };
	let outcome = state.run(&engine, &tools, &session_id, &abort, opts).await;
	opts.bridge.forget_conversation(&session_id);
	match outcome {
		Ok(Some(result)) => result,
		Err(e) => failed(&format!("the maker crashed: {e}")),
		// Iteration limit: the last written SVG goes out only if the model looked at it.
		Ok(None) => match state.current {
			Some(svg) if state.looked.as_ref() == Some(&svg) => {
				let notes = if state.final_text.is_empty() { "Iteration limit reached — delivering the last verified SVG.".to_owned() } else { state.final_text };
				json!({ "svg": svg, "notes": notes })
			}
			_ => failed(&format!("iteration limit ({MAX_ITERATIONS}) reached without a verified SVG.")),
		},
	}
}

struct Figure {
	messages: Vec<Json>,
	current: Option<String>,
	/// The SVG shown in the latest render.
	rendered: Option<String>,
	/// The SVG in a render the model has received.
	looked: Option<String>,
	final_text: String,
}

impl Figure {
	/// The loop: Some(result) when it ends with one, None at the iteration limit.
	async fn run(&mut self, engine: &gs_engine::turn::faux::Engine, tools: &[Json], session_id: &str, abort: &gs_engine::turn::abort::Abort, opts: &HelperOptions) -> Result<Option<Json>, RunError> {
		for _ in 0..MAX_ITERATIONS {
			let result = stream_once(engine, INSTRUCTIONS, &self.messages, tools, session_id, abort, &mut |u| opts.usage(u)).await?;
			// Every render already in the messages was part of that call's input.
			self.looked = self.rendered.clone();
			self.messages.push(result.clone());
			let calls = tool_calls(&result);
			if calls.is_empty() {
				self.final_text = trim(&message_text(&result)).to_owned();
				// Never deliver an unseen SVG: show the current one first.
				if let Some(svg) = self.current.clone().filter(|svg| self.rendered.as_ref() != Some(svg)) {
					let png = match opts.headless.render_svg(&svg).await {
						Ok(png) => png,
						Err(e) => return Ok(Some(failed(&format!("rendering the final SVG failed: {e}")))),
					};
					opts.activity("render_svg: inspecting final render");
					self.rendered = Some(svg);
					self.messages.push(png_message(UNLOOKED_FINISH_MESSAGE, &[&png]));
					continue;
				}
				return Ok(Some(finish(self.current.as_deref(), &self.final_text)));
			}
			let mut results = Vec::new();
			let mut render_png = None;
			for call in &calls {
				let text = self.call(call, &mut render_png, opts).await;
				let is_error = text.starts_with("ERROR:") || text.starts_with("RENDER ERROR");
				results.push(tool_text(&call["id"], &call["name"], &text, is_error));
			}
			// Order: the assistant's calls, the tool results, then the render.
			self.messages.extend(results);
			if let Some(png) = render_png {
				self.messages.push(png_message(LOOK_MESSAGE, &[&png]));
			}
		}
		Ok(None)
	}

	/// Runs one tool call; its text result.
	async fn call(&mut self, call: &Json, render_png: &mut Option<Vec<u8>>, opts: &HelperOptions) -> String {
		let args = &call["arguments"];
		match call["name"].as_str().unwrap_or_default() {
			"write_svg" => {
				let Some(svg) = args["svg"].as_str().filter(|svg| svg.contains("<svg")) else {
					return "ERROR: expected a complete <svg>…</svg> document in the `svg` field.".to_owned();
				};
				let size = len16(svg);
				self.current = Some(svg.to_owned());
				opts.activity(&format!("write_svg: {} KB", to_fixed(size as f64 / 1024.0, 1)));
				format!("Saved ({size} bytes). Call render_svg to look at it.")
			}
			"edit_svg" => {
				let Some(current) = &self.current else { return "ERROR: nothing to edit — call write_svg first.".to_owned() };
				let (Some(old), Some(new)) = (args["old_text"].as_str().filter(|o| !o.is_empty()), args["new_text"].as_str()) else {
					return "ERROR: expected old_text (non-empty) and new_text strings.".to_owned();
				};
				match current.matches(old).count() {
					0 => format!("ERROR: old_text not found. Closest line for reference:\n{}", snippet_around(current, old)),
					1 => {
						// The new text goes in as written ("$&" is not a pattern here).
						self.current = Some(current.replacen(old, new, 1));
						opts.activity("edit_svg: applied");
						"OK — replaced 1 occurrence. Call render_svg to look at the edited SVG.".to_owned()
					}
					n => format!("ERROR: old_text appears {n} times — it must match EXACTLY ONCE. Include more surrounding context to make it unique."),
				}
			}
			"render_svg" => {
				let Some(svg) = self.current.clone() else { return "ERROR: nothing to render — call write_svg first.".to_owned() };
				match opts.headless.render_svg(&svg).await {
					Ok(png) => {
						*render_png = Some(png);
						self.rendered = Some(svg);
						opts.activity("render_svg: inspecting render");
						"Rendered — the PNG follows in the next message. Look at it.".to_owned()
					}
					Err(e) => {
						opts.activity("render_svg: render error");
						format!("RENDER ERROR (the SVG may be malformed): {e}. Fix it with write_svg and render again.")
					}
				}
			}
			_ => format!("ERROR: unknown tool \"{}\". Use write_svg, edit_svg, or render_svg.", call["name"].as_str().unwrap_or("undefined")),
		}
	}
}

/// A 3-line numbered context window around the line most like a failed edit's text, enough for
/// the model to see what went wrong and retry.
fn snippet_around(svg: &str, target: &str) -> String {
	let words: Vec<&str> = trim(target).split(is_js_space).filter(|w| !w.is_empty()).collect();
	if words.is_empty() {
		return "(empty old_text)".to_owned();
	}
	let lines: Vec<&str> = svg.split('\n').collect();
	let mut best_at = 0;
	let mut best_score = None;
	for (i, line) in lines.iter().enumerate() {
		let score = words.iter().filter(|w| line.contains(**w)).count();
		if best_score.is_none_or(|best| score > best) {
			best_score = Some(score);
			best_at = i;
		}
	}
	let from = best_at.saturating_sub(1);
	let to = (best_at + 2).min(lines.len());
	lines[from..to].iter().enumerate().map(|(i, line)| format!("{} | {line}", from + i + 1)).collect::<Vec<_>>().join("\n")
}

fn finish(svg: Option<&str>, final_text: &str) -> Json {
	match svg {
		None => {
			let said = if final_text.is_empty() { String::new() } else { format!(" ({})", slice16(final_text, 0, Some(300))) };
			failed(&format!("the maker never wrote an SVG.{said}"))
		}
		Some(svg) if final_text.is_empty() => json!({ "svg": svg }),
		Some(svg) => json!({ "svg": svg, "notes": final_text }),
	}
}

#[cfg(test)]
#[path = "visual_maker_tests.rs"]
mod tests;
