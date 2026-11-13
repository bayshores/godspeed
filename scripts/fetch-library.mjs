/**
 * fetch-library.mjs — download one pinned native library into .stage/ (for fetch-pdfium.mjs and
 * fetch-onnxruntime.mjs).
 *
 * .stage/ is gitignored. The archive and the library inside it are both checked by sha256, so every
 * build ships the same bytes. A library already present with the right hash is skipped.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** `member` is the library's path inside the .tgz at `url`; `file` its name in .stage/. */
export async function fetchLibrary(tag, { url, archiveSha256, member, librarySha256, file }) {
	const fail = (message) => {
		console.error(`[${tag}] ${message}`);
		process.exit(1);
	};
	const target = path.join(path.resolve(import.meta.dirname, ".."), ".stage", file);
	if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === librarySha256) {
		console.log(`[${tag}] ready:`, target);
		return;
	}

	const res = await fetch(url);
	if (!res.ok) fail(`${url}: HTTP ${res.status}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	const archive = path.basename(new URL(url).pathname);
	if (sha256(bytes) !== archiveSha256) fail(`${archive}: sha256 mismatch, refusing to use it`);

	const work = fs.mkdtempSync(path.join(os.tmpdir(), `gs-${tag}-`));
	let library;
	try {
		fs.writeFileSync(path.join(work, archive), bytes);
		// A bare file name: GNU tar (first on PATH in Git Bash) reads `C:\…` as a remote host.
		execFileSync("tar", ["-xzf", archive, member], { cwd: work });
		library = fs.readFileSync(path.join(work, member));
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
	if (sha256(library) !== librarySha256) fail(`${member}: sha256 mismatch, refusing to use it`);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, library);
	console.log(`[${tag}] ${file} (${library.length} bytes)`);
	console.log(`[${tag}] ready:`, target);
}
