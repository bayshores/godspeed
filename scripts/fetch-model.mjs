/**
 * fetch-model.mjs — download the class-search embedding model into models/.
 *
 * models/ is gitignored: the files come from one pinned Hugging Face
 * revision and are checked by sha256, so every build ships the same bytes.
 * Files already present with the right hash are skipped. The desktop
 * builds run this before `next build`; scripts/build-server.mjs copies
 * models/ into the server payload.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const MODEL = "Snowflake/snowflake-arctic-embed-xs";
const REVISION = "d8c86521100d3556476a063fc2342036d45c106f";
const FILES = {
	"config.json": "d7d071046ab952af96b7abad788db7ab3fc997b465e1b9914ff39707092254ec",
	"tokenizer.json": "91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854",
	"tokenizer_config.json": "9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810",
	"onnx/model_quantized.onnx": "e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1",
};

const dir = path.join(path.resolve(import.meta.dirname, ".."), "models", MODEL);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const [name, expected] of Object.entries(FILES)) {
	const target = path.join(dir, name);
	if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === expected) continue;
	const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${name}`;
	const res = await fetch(url);
	if (!res.ok) {
		console.error(`[fetch-model] ${url}: HTTP ${res.status}`);
		process.exit(1);
	}
	const bytes = Buffer.from(await res.arrayBuffer());
	if (sha256(bytes) !== expected) {
		console.error(`[fetch-model] ${name}: sha256 mismatch, refusing to use it`);
		process.exit(1);
	}
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, bytes);
	console.log(`[fetch-model] ${name} (${bytes.length} bytes)`);
}
console.log("[fetch-model] model ready:", dir);
