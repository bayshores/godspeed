/**
 * POST /api/graph/import — No class's Import notes (a class adds notes on
 * its Files page): raw personal-notes files in, one extraction run
 * per file through the SAME pipeline the sessions use. Multipart form data
 * (field "files", any text format — the extractor is format-agnostic); the
 * pipeline mints a deterministic source id per file path, persists the
 * source record (the file's provenance + the run's usage), and runs
 * extractor → merger over the raw text.
 *
 * Small concurrency cap: the model calls are the slow part, and a burst of
 * 25 simultaneous runs would trip provider rate limits — a 3-wide worker
 * pool keeps the run registry (the dock's status chips) and the ledgers
 * healthy. The dock's chips + graph refetch track progress live through
 * /api/activity, as with session runs.
 */
import { extraction, NotesImportError } from "@/server";
import type { EmissionStats } from "@/core";

export const dynamic = "force-dynamic";

interface ImportResult {
	requestIndex: number;
	outcome: "completed" | "failed" | "partial" | "aborted" | "busy";
	filePath: string;
	ok: boolean;
	stats?: EmissionStats;
	error?: string;
}

export async function POST(request: Request) {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return Response.json({ results: [] as ImportResult[], error: "Invalid form body" }, { status: 400 });
	}
	const files = form.getAll("files").filter((f): f is File => f instanceof File);
	if (files.length === 0) {
		return Response.json({ results: [] as ImportResult[], error: "no files" }, { status: 400 });
	}

	const results: ImportResult[] = [];
	const queue = files.map((file, requestIndex) => ({ file, requestIndex }));
	const workers = Array.from({ length: Math.min(3, files.length) }, async () => {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			const { file, requestIndex } = next;
			try {
				const text = await file.text();
				const stats = await extraction.importNotes({ filePath: file.name, text });
				results.push({ filePath: file.name, requestIndex, outcome: "completed", ok: true, stats });
			} catch (err) {
				results.push({
					filePath: file.name, requestIndex, ok: false,
					outcome: err instanceof NotesImportError ? err.outcome : "failed",
					...(err instanceof NotesImportError ? { stats: err.partialStats } : {}),
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	});
	await Promise.all(workers);
	return Response.json({ results });
}
