//! The app version comes from the repo's package.json, as the Node build bakes it in.

fn main() -> Result<(), String> {
	let file = concat!(env!("CARGO_MANIFEST_DIR"), "/../../package.json");
	println!("cargo:rerun-if-changed={file}");
	let text = std::fs::read_to_string(file).map_err(|err| format!("{file}: {err}"))?;
	let key = "\"version\": \"";
	let start = text.find(key).ok_or("package.json has no version")? + key.len();
	let end = text[start..].find('"').ok_or("package.json's version has no closing quote")?;
	println!("cargo:rustc-env=GODSPEED_VERSION={}", &text[start..start + end]);
	Ok(())
}
