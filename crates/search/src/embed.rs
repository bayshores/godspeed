//! Text to normalized vectors with snowflake-arctic-embed-xs (src/backend/server/workers/embed-worker.mjs).
//!
//! The tokenizer and the quantized ONNX model live on a thread of their own and embed one batch at a
//! time, so a batch never holds up the async threads. Each batch is padded to its longest text and
//! cut at 512 tokens like the transformers.js pipeline, takes the [CLS] row and divides it by its
//! length the way transformers.js rounds (f32 sums of f64 squares).

use std::path::{Path, PathBuf};
use std::sync::mpsc;

use ort::session::Session;
use ort::value::Tensor;
use parking_lot::Mutex;
use tokenizers::Tokenizer;
use tokio::sync::oneshot;

pub const MODEL_ID: &str = "Snowflake/snowflake-arctic-embed-xs";
pub const DIMS: usize = 384;
/// The model reads at most this many tokens.
const MAX_TOKENS: usize = 512;

/// What a batch gets when the model thread is gone (the worker's exit message).
const STOPPED: &str = "The search worker stopped (code 1)";

type Reply = oneshot::Sender<Result<Vec<f32>, String>>;

struct Job {
	texts: Vec<String>,
	reply: Reply,
}

/// The handle to the model thread, started on first use and restarted after a crash.
pub struct Embedder {
	models: PathBuf,
	worker: Mutex<Option<mpsc::Sender<Job>>>,
}

impl Embedder {
	/// `models` is `<resources>/models`.
	pub fn new(models: PathBuf) -> Embedder {
		Embedder { models, worker: Mutex::new(None) }
	}

	/// One batch: normalized vectors, row after row (texts already carry any query prefix).
	pub async fn embed_batch(&self, texts: Vec<String>) -> Result<Vec<f32>, String> {
		let (reply, answer) = oneshot::channel();
		self.send(Job { texts, reply })?;
		answer.await.unwrap_or_else(|_| Err(STOPPED.to_owned()))
	}

	fn send(&self, job: Job) -> Result<(), String> {
		let mut worker = self.worker.lock();
		let job = match worker.as_ref() {
			Some(tx) => match tx.send(job) {
				Ok(()) => return Ok(()),
				// The thread died (a panic): start another, like a crashed worker.
				Err(mpsc::SendError(job)) => job,
			},
			None => job,
		};
		self.start(&mut worker)?.send(job).map_err(|_| STOPPED.to_owned())
	}

	fn start<'a>(&self, worker: &'a mut Option<mpsc::Sender<Job>>) -> Result<&'a mpsc::Sender<Job>, String> {
		let weights = self.models.join(MODEL_ID).join("onnx").join("model_quantized.onnx");
		if !weights.exists() {
			return Err(format!("The search model is missing ({}). Reinstall or update godspeed to get it back (from source: run `node scripts/fetch-model.mjs`).", weights.display()));
		}
		let (tx, rx) = mpsc::channel::<Job>();
		let dir = self.models.join(MODEL_ID);
		std::thread::Builder::new()
			.name("embed".to_owned())
			.spawn(move || serve(&dir, &rx))
			.map_err(|e| e.to_string())?;
		Ok(worker.insert(tx))
	}
}

/// Loads once (a failed load answers every batch with its error, like the worker's rejected
/// `ready`), then embeds what arrives.
fn serve(dir: &Path, jobs: &mpsc::Receiver<Job>) {
	let mut model = Model::load(dir);
	for job in jobs {
		let out = match &mut model {
			Ok(m) => m.embed(&job.texts),
			Err(e) => Err(e.clone()),
		};
		let _ = job.reply.send(out);
	}
}

struct Model {
	tokenizer: Tokenizer,
	session: Session,
	inputs: Vec<String>,
}

impl Model {
	fn load(dir: &Path) -> Result<Model, String> {
		let tokenizer = load_tokenizer(dir)?;
		let session = Session::builder().map_err(|e| e.to_string())?.commit_from_file(dir.join("onnx").join("model_quantized.onnx")).map_err(|e| e.to_string())?;
		let inputs = session.inputs().iter().map(|i| i.name().to_owned()).collect();
		Ok(Model { tokenizer, session, inputs })
	}

	fn embed(&mut self, texts: &[String]) -> Result<Vec<f32>, String> {
		let batch = encode(&self.tokenizer, texts)?;
		let mut feed = Vec::new();
		for name in &self.inputs {
			let data = match name.as_str() {
				"input_ids" => batch.ids.clone(),
				"attention_mask" => batch.mask.clone(),
				"token_type_ids" => batch.types.clone(),
				other => return Err(format!("The search model wants an unknown input \"{other}\"")),
			};
			let tensor = Tensor::from_array(([batch.rows, batch.width], data)).map_err(|e| e.to_string())?;
			feed.push((name.clone(), tensor));
		}
		let outputs = self.session.run(feed).map_err(|e| e.to_string())?;
		let (_, hidden) = outputs["last_hidden_state"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
		let mut out = Vec::with_capacity(batch.rows * DIMS);
		for r in 0..batch.rows {
			let at = r * batch.width * DIMS;
			out.extend(normalized(&hidden[at..at + DIMS]));
		}
		Ok(out)
	}
}

/// The tokenizer without its own cut and padding: `encode` does both like transformers.js.
fn load_tokenizer(dir: &Path) -> Result<Tokenizer, String> {
	let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|e| e.to_string())?;
	tokenizer.with_truncation(None).map_err(|e| e.to_string())?;
	tokenizer.with_padding(None);
	Ok(tokenizer)
}

/// The model's inputs for a batch, `rows` x `width`, zero-padded on the right.
struct Batch {
	rows: usize,
	width: usize,
	ids: Vec<i64>,
	mask: Vec<i64>,
	types: Vec<i64>,
}

fn encode(tokenizer: &Tokenizer, texts: &[String]) -> Result<Batch, String> {
	let encodings = tokenizer.encode_batch(texts.to_vec(), true).map_err(|e| e.to_string())?;
	let rows = encodings.len();
	// transformers.js cuts after adding [CLS] and [SEP], so a long text loses its [SEP].
	let lengths: Vec<usize> = encodings.iter().map(|e| e.len().min(MAX_TOKENS)).collect();
	let width = lengths.iter().copied().max().unwrap_or(0);
	let column = |pick: fn(&tokenizers::Encoding) -> &[u32]| {
		let mut out = vec![0; rows * width];
		for (r, e) in encodings.iter().enumerate() {
			for (c, &v) in pick(e)[..lengths[r]].iter().enumerate() {
				out[r * width + c] = i64::from(v);
			}
		}
		out
	};
	Ok(Batch {
		rows,
		width,
		ids: column(tokenizers::Encoding::get_ids),
		mask: column(tokenizers::Encoding::get_attention_mask),
		types: column(tokenizers::Encoding::get_type_ids),
	})
}

/// `tensor.normalize(2, -1)` in transformers.js: the sum of squares kept in a Float32Array, then
/// each value divided by its square root.
fn normalized(row: &[f32]) -> Vec<f32> {
	let sum = row.iter().fold(0f32, |acc, &x| (f64::from(acc) + f64::from(x) * f64::from(x)) as f32);
	let norm = f64::from(sum).sqrt() as f32;
	row.iter().map(|&x| (f64::from(x) / f64::from(norm)) as f32).collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn normalized_rows_have_unit_length() {
		let v = normalized(&[3.0, 4.0]);
		assert_eq!(v, vec![0.6, 0.8]);
	}

	/// Token ids against transformers.js for the golden batches (tests/golden/embed.json).
	#[test]
	fn tokens_match_transformers_js() {
		let root = Path::new(env!("CARGO_MANIFEST_DIR"));
		let tokenizer = load_tokenizer(&root.join("../../models").join(MODEL_ID)).expect("models/ is missing: run node scripts/fetch-model.mjs");
		let golden = gs_json::parse(&std::fs::read_to_string(root.join("tests/golden/embed.json")).unwrap()).unwrap();
		let case = |name: &str| golden.as_arr().unwrap().iter().find(|c| c["name"] == gs_json::Json::from(name)).unwrap()["output"].clone();
		let want = case("tokens");
		for (name, texts) in case("batches").as_obj().unwrap().iter() {
			let texts: Vec<String> = texts.as_arr().unwrap().iter().map(|t| t.as_str().unwrap().to_owned()).collect();
			let batch = encode(&tokenizer, &texts).unwrap();
			let want: Vec<i64> = want[name.as_str()].as_arr().unwrap().iter().flat_map(|r| r.as_arr().unwrap().iter().map(|n| n.as_i64().unwrap())).collect();
			assert_eq!(batch.ids, want, "{name}");
		}
	}

	#[tokio::test]
	async fn a_missing_model_says_how_to_get_it() {
		let e = Embedder::new(PathBuf::from("/nowhere/models"));
		let err = e.embed_batch(vec!["x".to_owned()]).await.unwrap_err();
		let weights = Path::new("/nowhere/models").join(MODEL_ID).join("onnx").join("model_quantized.onnx");
		assert_eq!(err, format!("The search model is missing ({}). Reinstall or update godspeed to get it back (from source: run `node scripts/fetch-model.mjs`).", weights.display()));
	}
}
