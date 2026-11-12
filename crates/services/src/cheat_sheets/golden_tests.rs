//! Replays tests/golden/cheat-sheets.json, which the TypeScript server code recorded over a
//! synthetic space: the same files, the same calls, the same answers. The recorded times and ids
//! of the TypeScript run are masked ("<now>", "<id>"), and so are the temp folders.
//!
//! The PDFs are read by pdfium, so a run without the library prints why and passes.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use gs_base::config::Paths;
use gs_base::fsx::write_atomic;
use gs_base::hash::sha256_hex;
use gs_base::time::parse_date;
use gs_core::messages::attachments::ChatAttachment;
use gs_json::{Json, Obj, json, parse, stringify};
use gs_pdf::test_support::pdfium_dir;

use gs_base::base64::decode;
use super::cheat_sheet_pdf::take_sheet_pdf;
use super::{AskInput, Outcome, Stop, ask, cheat_sheet_file, cheat_sheet_pdf, cheat_sheet_view, space_sheets_view, remove_rule, retry, sheet_pdf_file, stop};
use crate::App;

fn is_iso(s: &str) -> bool {
	let b = s.as_bytes();
	b.len() == 24 && b.iter().enumerate().all(|(i, &c)| match i {
		4 | 7 => c == b'-',
		10 => c == b'T',
		13 | 16 => c == b':',
		19 => c == b'.',
		23 => c == b'Z',
		_ => c.is_ascii_digit(),
	})
}

fn is_uuid(s: &str) -> bool {
	let b = s.as_bytes();
	b.len() == 36 && b.iter().enumerate().all(|(i, &c)| if matches!(i, 8 | 13 | 18 | 23) { c == b'-' } else { c.is_ascii_hexdigit() && !c.is_ascii_uppercase() })
}

/// What differs by run is masked the way cheat-sheets.run.ts masks it.
struct Mask {
	data: String,
	home: String,
}

impl Mask {
	fn apply(&self, v: &Json) -> Json {
		match v {
			Json::Str(s) if is_iso(s) && !s.starts_with("2029-") => "<now>".into(),
			Json::Str(s) if is_uuid(s) => "<id>".into(),
			Json::Str(s) => s.replace(&self.data, "<data>").replace(&self.home, "<home>").into(),
			Json::Arr(all) => Json::Arr(all.iter().map(|x| self.apply(x)).collect()),
			Json::Obj(o) => Json::Obj(o.iter().map(|(k, x)| (k.clone(), self.apply(x))).collect::<Obj>()),
			other => other.clone(),
		}
	}
}

fn outcome(result: Outcome<Json>) -> Json {
	match result {
		Ok(value) => json!({ "ok": true, "value": value }),
		Err(Stop::Refuse(status, error)) => json!({ "ok": false, "status": status, "error": error }),
		Err(Stop::Throw(message)) => json!({ "threw": message }),
	}
}

fn set_mtime(file: &Path, iso: &str) {
	let ms = parse_date(iso).expect("a date");
	let at = SystemTime::UNIX_EPOCH + Duration::from_millis(u64::try_from(ms).expect("after 1970"));
	std::fs::File::options().write(true).open(file).unwrap().set_modified(at).unwrap();
}

fn write_file(root: &Path, rel: &str, bytes: &[u8]) -> PathBuf {
	let file = root.join(rel);
	std::fs::create_dir_all(file.parent().unwrap()).unwrap();
	write_atomic(&file, bytes, None).unwrap();
	file
}

fn sorted_names(dir: &Path) -> Json {
	let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
	names.sort();
	Json::Arr(names.into_iter().map(Json::from).collect())
}

/// The recorded files of a folder, "<home>" in saved sheets made real.
fn restore(root: &Path, files: &Json, home: &str) {
	for entry in files.as_arr().unwrap() {
		let (rel, data) = (entry[0].as_str().unwrap(), entry[1].as_str().unwrap());
		let mut bytes = decode(data);
		if rel.ends_with(".json") {
			bytes = String::from_utf8(bytes).unwrap().replace("<home>", home).into_bytes();
		}
		write_file(root, rel, &bytes);
	}
}

fn bytes_summary(bytes: &[u8]) -> Json {
	json!({ "size": bytes.len(), "sha256": sha256_hex(bytes) })
}

fn ask_input(body: &Json) -> AskInput {
	let attachments = body.get("attachments").map(|all| {
		let text = |a: &Json, key: &str| a[key].as_str().unwrap().to_owned();
		all.as_arr().unwrap().iter().map(|a| ChatAttachment { name: text(a, "name"), mime_type: text(a, "mimeType"), data: text(a, "data") }).collect()
	});
	AskInput { text: body["text"].as_str().unwrap().to_owned(), attachments, region: body.get("region").cloned(), about: body.get("about").cloned() }
}

async fn replay(app: &Arc<App>, mask: &Mask, home: &Path, data: &Path, step: &Json) -> Json {
	let (cls, ddl) = (step["cls"].as_str().unwrap_or(""), step["ddl"].as_str().unwrap_or(""));
	let sheets_home = home.join("godspeed").join("cheat-sheets");
	let n = step["n"].as_f64().unwrap_or(0.0);
	let out = match step["op"].as_str().unwrap() {
		"space" => outcome(space_sheets_view(app, cls)),
		"view" => outcome(cheat_sheet_view(app, cls, ddl).await),
		"pdf" => cheat_sheet_pdf(app, cls, ddl, n).map_or(Json::Null, |bytes| bytes_summary(&bytes)),
		"kept" => cheat_sheet_file(app, cls, ddl, step["file"].as_str().unwrap()).map_or(Json::Null, |(bytes, kind)| json!({ "type": kind, "size": bytes.len(), "sha256": sha256_hex(&bytes) })),
		"ask" => outcome(ask(app, cls, ddl, ask_input(&step["body"])).map(|()| Json::Null)),
		"retry" => outcome(retry(app, cls, ddl).map(|()| Json::Null)),
		"stop" => {
			stop(app, ddl);
			Json::Null
		}
		"removeRule" => outcome(remove_rule(app, cls, ddl, step["text"].as_str().unwrap()).map(|()| Json::Null)),
		"sheet" => {
			let file = data.join("spaces").join(cls_of(data)).join("cheat-sheets").join(format!("{ddl}.json"));
			std::fs::read_to_string(file).ok().and_then(|text| parse(&text).ok()).unwrap_or(Json::Null)
		}
		"file" => outcome(sheet_pdf_file(app, cls, ddl, n).map(Json::from)),
		"ls" => sorted_names(&sheets_home.join(step["dir"].as_str().unwrap())),
		"versions" => sorted_names(&data.join("spaces").join(cls_of(data)).join("cheat-sheets").join(format!("{ddl}-versions"))),
		"put" => {
			let file = write_file(&sheets_home, step["path"].as_str().unwrap(), &decode(step["base64"].as_str().unwrap()));
			set_mtime(&file, step["mtime"].as_str().unwrap());
			Json::Null
		}
		"link" => {
			let outside = write_file(home, step["outside"].as_str().unwrap(), &decode(step["base64"].as_str().unwrap()));
			std::os::unix::fs::symlink(outside, sheets_home.join(step["path"].as_str().unwrap())).unwrap();
			Json::Null
		}
		"take" => {
			let given = step["pdfPath"].as_str().unwrap().replace("<home>", &mask.home);
			match take_sheet_pdf(app, &sheets_home.join(step["folder"].as_str().unwrap()), &given).await {
				Ok(got) => json!({ "pages": got.pages, "file": got.file, "size": got.bytes.len(), "sha256": sha256_hex(&got.bytes) }),
				Err(error) => json!({ "error": error }),
			}
		}
		other => panic!("unknown step {other}"),
	};
	mask.apply(&out)
}

/// The one space folder in the data folder.
fn cls_of(data: &Path) -> String {
	sorted_names(&data.join("spaces"))[0].as_str().unwrap().to_owned()
}

#[test]
fn replays_the_recorded_steps() {
	let Some(pdfium) = pdfium_dir() else { return };
	let recorded = parse(&std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/cheat-sheets.json")).unwrap()).unwrap();
	let case = &recorded[0]["output"];

	let root = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("gs-sheets-golden-{}", std::process::id()));
	let (data, home, tmp) = (root.join("data"), root.join("home"), root.join("tmp"));
	for dir in [&data, &home, &tmp] {
		std::fs::create_dir_all(dir).unwrap();
	}
	let mask = Mask { data: data.to_string_lossy().into_owned(), home: home.to_string_lossy().into_owned() };
	restore(&data, &case["before"]["data"], &mask.home);
	restore(&home, &case["before"]["home"], &mask.home);

	let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
	let mut wrong = Vec::new();
	runtime.block_on(async {
		let app = App::new(Paths::new(data.clone(), home.clone(), tmp.clone(), pdfium), None);
		for (i, step) in case["steps"].as_arr().unwrap().iter().enumerate() {
			let got = replay(&app, &mask, &home, &data, step).await;
			if stringify(&got) != stringify(&step["out"]) {
				wrong.push(format!("step {i} {}:\n  want {}\n  got  {}", stringify(&json!({ "op": step["op"], "ddl": step["ddl"] })), stringify(&step["out"]), stringify(&got)));
			}
		}
	});
	std::fs::remove_dir_all(&root).ok();
	assert!(wrong.is_empty(), "{} steps differ:\n{}", wrong.len(), wrong.join("\n"));
}
