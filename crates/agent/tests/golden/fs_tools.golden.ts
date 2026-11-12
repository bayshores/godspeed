// The learner-filesystem tools (read, ls, find, grep) and the researcher's web and PDF tools on
// the real TypeScript, over a small made-up folder. Each case is one tool call with its answer
// (the temp folder's path is written as <ROOT>). tests/fs_tools_golden.rs builds the same folder
// from the `fixture` case and replays every call on the Rust tools. The web fetch and the PDF
// reading itself (page text, markdown) are not here: they differ on purpose and have their own
// tests; only the answers that never touch the network or a PDF are.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const src = "../../../../src/backend/agent/tools";
const { readTool } = await import(`${src}/read.ts`);
const { lsTool } = await import(`${src}/ls.ts`);
const { findTool } = await import(`${src}/find.ts`);
const { grepTool } = await import(`${src}/grep.ts`);
const { webTools } = await import(`${src}/web.ts`);
const { createPdfReadTools } = await import(`${src}/pdf-read.ts`);

type Tool = { name: string; description: string; parameters: unknown; execute: (id: string, args: unknown, signal?: AbortSignal) => Promise<unknown> };

/** A file's content: pieces joined, where a pair is a piece repeated. */
type Piece = string | [string, number];
type FileSpec = { path: string; content?: Piece[]; hex?: string; numbered?: [string, number] };

const PNG = "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082";

const files: FileSpec[] = [
	{ path: "notes/a.txt", content: ["alpha\nbeta\ngamma\n"] },
	{ path: "notes/b.md", content: ["# Title\r\nCRLF line needle\r\nsecond\rthird café\n"] },
	{ path: "notes/Zeta.txt", content: ["upper"] },
	{ path: "notes/alpha-dir/inner.txt", content: ["inner needle"] },
	{ path: "notes/.hidden", content: ["dotfile needle"] },
	{ path: "notes/empty.txt", content: [""] },
	{ path: "notes/unicode-日本語.txt", content: ["日本語 needle \u{1f600}\n"] },
	{ path: "bin/data.bin", hex: "000102ff00" },
	{ path: "bin/fake.pdf", content: ["%PDF-1.4 ascii only"] },
	{ path: "bin/pic.png", hex: PNG },
	{ path: "bin/photo.JPG", hex: "ffd8ffe000104a464946" },
	{ path: "long/2500-lines.txt", numbered: ["line", 2500] },
	{ path: "long/wide.txt", content: [["w".repeat(999) + "\n", 100]] },
	{ path: "long/one-line.txt", content: [["é", 40000], "\nnext"] },
	{ path: "long/last-line.txt", content: [["y", 60000]] },
	{ path: "grep/many.txt", numbered: ["match", 250] },
	{ path: "grep/big.txt", content: [["needle line\n", 200000]] },
	{ path: "grep/longline.txt", content: ["needle ", ["z", 600], "\nshort needle\n"] },
	{ path: "grep/wide-lines.txt", content: [["hit " + "q".repeat(480) + "\n", 200]] },
	{ path: "grep/context.txt", content: ["one\ntwo hit\nthree\nfour\nfive\nsix hit\nseven\n"] },
	{ path: "tree/node_modules/pkg.js", content: ["needle"] },
	{ path: "tree/.git/config", content: ["needle"] },
	{ path: "tree/Library/x.txt", content: ["needle"] },
	{ path: "tree/.Trash/y.txt", content: ["needle"] },
	{ path: "tree/src/main.ts", content: ["export const needle = 1;\n"] },
	{ path: "tree/src/deep/util.ts", content: ["// needle\n"] },
	{ path: "tree/src/deep/util.spec.ts", content: ["// needle test\n"] },
	{ path: "tree/README.md", content: ["# readme\n"] },
	{ path: "tree/data.json", content: ["{}\n"] },
	{ path: "case/B.txt", content: [""] },
	{ path: "case/a.txt", content: [""] },
	{ path: "case/C.txt", content: [""] },
	{ path: "case/b.txt", content: [""] },
	{ path: "case/_u.txt", content: [""] },
	{ path: "case/Ärger.txt", content: [""] },
	{ path: "case/zebra.txt", content: [""] },
	{ path: "case/10.txt", content: [""] },
	{ path: "case/9.txt", content: [""] },
	{ path: "case/é.txt", content: [""] },
	{ path: "case/e.txt", content: [""] },
	{ path: "locked-dir/secret.txt", content: ["secret"] },
	{ path: "locked-file.txt", content: ["secret"] },
];
const dirs = ["empty-dir", "pdf-job"];
/** Folders of many empty files: the name has `{i}` for the number. */
const generated = [{ dir: "bigdir", count: 520, name: `n-{i}-${"x".repeat(100)}.txt` }];
const links: [string, string][] = [["link-to-a", "notes/a.txt"], ["link-to-dir", "notes"], ["dangling", "nowhere"]];
const modes: [string, number][] = [["locked-dir", 0], ["locked-file.txt", 0]];
const fixture = { files, dirs, generated, links, modes };

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gs-fs-tools-golden-")));
process.on("exit", () => {
	for (const [name] of modes) fs.chmodSync(path.join(root, name), 0o755);
	fs.rmSync(root, { recursive: true, force: true });
});

function content(spec: FileSpec): Buffer {
	if (spec.hex !== undefined) return Buffer.from(spec.hex, "hex");
	if (spec.numbered) return Buffer.from(Array.from({ length: spec.numbered[1] }, (_, i) => `${spec.numbered![0]} ${i + 1}`).join("\n"));
	return Buffer.from((spec.content ?? []).map((p) => (typeof p === "string" ? p : p[0].repeat(p[1]))).join(""));
}
for (const spec of files) {
	const file = path.join(root, spec.path);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content(spec));
}
for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
for (const { dir, count, name } of generated) {
	fs.mkdirSync(path.join(root, dir), { recursive: true });
	for (let i = 1; i <= count; i++) fs.writeFileSync(path.join(root, dir, name.replace("{i}", String(i).padStart(4, "0"))), "");
}
for (const [name, target] of links) fs.symlinkSync(path.join(root, target), path.join(root, name));
for (const [name, mode] of modes) fs.chmodSync(path.join(root, name), mode);

const fsTools: Record<string, Tool> = { read: readTool, ls: lsTool, find: findTool, grep: grepTool };
const pdfTools = createPdfReadTools(path.join(root, "pdf-job")) as Record<string, Tool>;
const allTools: Record<string, Tool> = { ...fsTools, ...(webTools as Record<string, Tool>), ...pdfTools };

const unroot = (value: unknown): unknown => JSON.parse(JSON.stringify(value).replaceAll(root, "<ROOT>"));
const real = (args: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(args).replaceAll("<ROOT>", root));

type Call = { tool: string; args: Record<string, unknown>; aborted?: boolean };
async function run({ tool, args, aborted }: Call) {
	const controller = new AbortController();
	if (aborted) controller.abort();
	try {
		return unroot({ tool, args, aborted, result: await allTools[tool]!.execute("call", real(args), controller.signal) });
	} catch (err) {
		return unroot({ tool, args, aborted, error: err instanceof Error ? err.message : String(err) });
	}
}

const R = "<ROOT>";
const calls: Record<string, Call> = {};
const add = (name: string, tool: string, args: Record<string, unknown>, aborted?: boolean) => {
	calls[name] = { tool, args, aborted };
};

// read
add("read: a text file", "read", { path: `${R}/notes/a.txt` });
add("read: offset and limit", "read", { path: `${R}/notes/a.txt`, offset: 2, limit: 1 });
add("read: offset past the end", "read", { path: `${R}/notes/a.txt`, offset: 99 });
add("read: offset on the empty last line", "read", { path: `${R}/notes/a.txt`, offset: 4 });
add("read: line endings stay", "read", { path: `${R}/notes/b.md` });
add("read: unicode name", "read", { path: `${R}/notes/unicode-日本語.txt` });
add("read: an empty file", "read", { path: `${R}/notes/empty.txt` });
add("read: a dotfile", "read", { path: `${R}/notes/.hidden` });
add("read: the line ceiling", "read", { path: `${R}/long/2500-lines.txt` });
add("read: the line ceiling from the middle", "read", { path: `${R}/long/2500-lines.txt`, offset: 2400 });
add("read: a limit under the ceiling", "read", { path: `${R}/long/2500-lines.txt`, limit: 5 });
add("read: the byte ceiling", "read", { path: `${R}/long/wide.txt` });
add("read: one line over the byte ceiling", "read", { path: `${R}/long/one-line.txt` });
add("read: the last line over the byte ceiling", "read", { path: `${R}/long/last-line.txt` });
add("read: a binary file", "read", { path: `${R}/bin/data.bin` });
add("read: a pdf", "read", { path: `${R}/bin/fake.pdf` });
add("read: a png", "read", { path: `${R}/bin/pic.png` });
add("read: an upper-case jpg", "read", { path: `${R}/bin/photo.JPG` });
add("read: a missing file", "read", { path: `${R}/nope.txt` });
add("read: a missing pdf", "read", { path: `${R}/nope.pdf` });
add("read: a folder", "read", { path: `${R}/notes` });
add("read: a locked file", "read", { path: `${R}/locked-file.txt` });
add("read: through a link", "read", { path: `${R}/link-to-a` });
add("read: a dangling link", "read", { path: `${R}/dangling` });

// ls
add("ls: a folder", "ls", { path: `${R}/notes` });
add("ls: the root with links", "ls", { path: R });
add("ls: mixed case and accents", "ls", { path: `${R}/case` });
add("ls: a small limit", "ls", { path: `${R}/case`, limit: 3 });
add("ls: the entry and byte limits", "ls", { path: `${R}/bigdir` });
add("ls: an empty folder", "ls", { path: `${R}/empty-dir` });
add("ls: a locked folder", "ls", { path: `${R}/locked-dir` });
add("ls: a missing folder", "ls", { path: `${R}/nope` });
add("ls: a file", "ls", { path: `${R}/notes/a.txt` });
add("ls: a linked folder", "ls", { path: `${R}/link-to-dir` });

// find
add("find: by extension", "find", { pattern: "*.ts", path: `${R}/tree` });
add("find: a deep spec", "find", { pattern: "**/*.spec.ts", path: `${R}/tree` });
add("find: a path glob", "find", { pattern: "src/**/*.ts", path: `${R}/tree` });
add("find: braces", "find", { pattern: "*.{ts,md}", path: `${R}/tree` });
add("find: a name prefix", "find", { pattern: "util*", path: `${R}/tree` });
add("find: anchored", "find", { pattern: "/README.md", path: `${R}/tree` });
add("find: one folder up", "find", { pattern: "deep/*.ts", path: `${R}/tree` });
add("find: one unit", "find", { pattern: "unicode-???.txt", path: `${R}/notes` });
add("find: nothing", "find", { pattern: "*.zzz", path: `${R}/tree` });
add("find: a limit", "find", { pattern: "*", path: `${R}/tree`, limit: 2 });
add("find: exactly the limit", "find", { pattern: "*.json", path: `${R}/tree`, limit: 1 });
add("find: inside a noise folder", "find", { pattern: "*", path: `${R}/tree/node_modules` });
add("find: the notes", "find", { pattern: "*", path: `${R}/notes` });
add("find: links are not followed", "find", { pattern: "*.txt", path: R, limit: 1000 });
add("find: a missing folder", "find", { pattern: "*", path: `${R}/nope` });
add("find: a file", "find", { pattern: "*", path: `${R}/notes/a.txt` });
add("find: stopped", "find", { pattern: "*", path: `${R}/tree` }, true);

// grep
add("grep: a word", "grep", { pattern: "needle", path: `${R}/notes` });
add("grep: ignore case", "grep", { pattern: "NEEDLE", path: `${R}/notes`, ignoreCase: true });
add("grep: case matters", "grep", { pattern: "NEEDLE", path: `${R}/notes` });
add("grep: a regex and a glob", "grep", { pattern: "needl+e", path: `${R}/notes`, glob: "*.txt" });
add("grep: a deep glob", "grep", { pattern: "needle", path: `${R}/tree`, glob: "**/*.ts" });
add("grep: noise folders are skipped", "grep", { pattern: ".", path: `${R}/tree` });
add("grep: context", "grep", { pattern: "hit", path: `${R}/grep/context.txt`, context: 1 });
add("grep: wide context", "grep", { pattern: "hit", path: `${R}/grep/context.txt`, context: 3 });
add("grep: context across files", "grep", { pattern: "needle", path: `${R}/notes`, context: 1 });
add("grep: line endings", "grep", { pattern: "second|CRLF", path: `${R}/notes/b.md` });
add("grep: a limit across files", "grep", { pattern: "needle", path: `${R}/notes`, limit: 1 });
add("grep: exactly the limit", "grep", { pattern: "^match", path: `${R}/grep/many.txt`, limit: 3 });
add("grep: the default limit", "grep", { pattern: "match", path: `${R}/grep/many.txt` });
add("grep: a long line", "grep", { pattern: "needle", path: `${R}/grep/longline.txt` });
add("grep: the byte ceiling", "grep", { pattern: "hit", path: `${R}/grep/wide-lines.txt`, limit: 150 });
add("grep: a literal bracket", "grep", { pattern: "(", path: `${R}/grep/many.txt`, literal: true });
add("grep: a literal dot", "grep", { pattern: "match.1", path: `${R}/grep/many.txt`, literal: true });
add("grep: no match", "grep", { pattern: "zzz-not-here", path: `${R}/notes` });
add("grep: an open group", "grep", { pattern: "(", path: `${R}/notes` });
add("grep: nothing to repeat", "grep", { pattern: "*", path: `${R}/notes` });
add("grep: an open space", "grep", { pattern: "[a", path: `${R}/notes`, ignoreCase: true });
add("grep: a stray close", "grep", { pattern: "a)", path: `${R}/notes` });
add("grep: a bad quantifier", "grep", { pattern: "a{2,1}", path: `${R}/notes` });
add("grep: a lone backslash", "grep", { pattern: "a\\", path: `${R}/notes` });
add("grep: a bad range", "grep", { pattern: "[z-a]", path: `${R}/notes` });
add("grep: a named file", "grep", { pattern: "beta", path: `${R}/notes/a.txt` });
add("grep: a named binary file", "grep", { pattern: "x", path: `${R}/bin/data.bin` });
add("grep: a named pdf", "grep", { pattern: "PDF", path: `${R}/bin/fake.pdf` });
add("grep: a named huge file", "grep", { pattern: "needle", path: `${R}/grep/big.txt` });
add("grep: a huge file in a walk", "grep", { pattern: "needle", path: `${R}/grep`, glob: "big.txt" });
add("grep: a missing path", "grep", { pattern: "x", path: `${R}/nope` });
add("grep: stopped", "grep", { pattern: "needle", path: `${R}/notes` }, true);

// web and pdf: only what never leaves the machine
for (const url of ["not a url", "ftp://example.com/x", "file:///etc/hosts", "", "mailto:a@b.c"]) {
	add(`web_fetch: refuses ${JSON.stringify(url)}`, "web_fetch", { url });
	add(`web_fetch_pdf: refuses ${JSON.stringify(url)}`, "web_fetch_pdf", { url });
}
for (const tool of ["pdf_info", "pdf_extract", "pdf_search"]) {
	const extra = tool === "pdf_extract" ? { pages: "all" } : tool === "pdf_search" ? { query: "x" } : {};
	for (const p of ["../outside.pdf", "/etc/passwd", "", `${R}/pdf-job`, `${R}/pdf-job-two/x.pdf`, "sub/../../x.pdf"]) {
		add(`${tool}: refuses ${JSON.stringify(p)}`, tool, { path: p, ...extra });
	}
}

const definitions = Object.values(allTools).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

const cases: Record<string, () => unknown> = {
	fixture: () => fixture,
	definitions: () => definitions,
};
for (const [name, call] of Object.entries(calls)) cases[name] = () => run(call);
export default cases;
