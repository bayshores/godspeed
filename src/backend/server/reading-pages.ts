/**
 * The pages behind the lesson's "agent at work" view: the file the teacher
 * is reading, as text or as rendered PDF pages. Only plain files under the
 * learner's home are served (the same anchor the read tool resolves
 * against), never anything inside a dot folder.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSourcePath } from "../agent/tools/fs-shared.ts";
import { pdfShape } from "../agent/subagents/pdf-ops.ts";
import { getHeadless } from "../agent/subagents/headless.ts";

const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_DPI = 100;
const CACHE_LIMIT = 48;

type ReadingOutcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

type ReadingDocument = { kind: "text"; text: string } | { kind: "pdf"; pageCount: number; aspect: number };

const pageCache = new Map<string, Buffer>();

async function servable(rawPath: string): Promise<ReadingOutcome<{ absolute: string; mtimeMs: number; size: number }>> {
	const home = os.homedir();
	const absolute = path.resolve(resolveSourcePath(rawPath));
	const relative = path.relative(home, absolute);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).some((s) => s.startsWith("."))) {
		return { ok: false, status: 403, error: "Not a file the teacher can show" };
	}
	const stat = await fs.stat(absolute).catch(() => null);
	if (!stat?.isFile()) return { ok: false, status: 404, error: "No such file" };
	return { ok: true, value: { absolute, mtimeMs: stat.mtimeMs, size: stat.size } };
}

const isPdf = (file: string) => path.extname(file).toLowerCase() === ".pdf";

/** The whole document: its text, or a PDF's page count and page shape. */
export async function readingDocument(rawPath: string): Promise<ReadingOutcome<ReadingDocument>> {
	const file = await servable(rawPath);
	if (!file.ok) return file;
	const { absolute, size } = file.value;
	if (isPdf(absolute)) {
		const shape = await pdfShape(absolute).catch(() => null);
		if (!shape) return { ok: false, status: 415, error: "Unreadable PDF" };
		return { ok: true, value: { kind: "pdf", ...shape } };
	}
	if (size > TEXT_MAX_BYTES) return { ok: false, status: 413, error: "File too large" };
	const text = await fs.readFile(absolute, "utf-8");
	if (text.includes("\u0000")) return { ok: false, status: 415, error: "Not a text file" };
	return { ok: true, value: { kind: "text", text } };
}

/** One PDF page as a PNG, cached by file version. */
export async function readingPdfPage(rawPath: string, page: number): Promise<ReadingOutcome<Buffer>> {
	const file = await servable(rawPath);
	if (!file.ok) return file;
	const { absolute, mtimeMs } = file.value;
	if (!isPdf(absolute)) return { ok: false, status: 415, error: "Not a PDF" };
	const key = `${absolute}:${mtimeMs}:${page}`;
	const cached = pageCache.get(key);
	if (cached) return { ok: true, value: cached };
	const [rendered] = await getHeadless().renderPdfPages(absolute, [page], { dpi: PAGE_DPI });
	if (!rendered) return { ok: false, status: 404, error: "No such page" };
	pageCache.set(key, rendered.png);
	if (pageCache.size > CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value!);
	return { ok: true, value: rendered.png };
}
