//! The app version comes from the repo's package.json, as the Node build bakes it in.

fn main() {
	let file = concat!(env!("CARGO_MANIFEST_DIR"), "/../../package.json");
	println!("cargo:rerun-if-changed={file}");
	let text = std::fs::read_to_string(file).expect("package.json");
	let start = text.find("\"version\": \"").expect("a version in package.json") + "\"version\": \"".len();
	let version = &text[start..start + text[start..].find('"').expect("closing quote")];
	println!("cargo:rustc-env=GODSPEED_VERSION={version}");
}
