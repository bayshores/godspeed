/**
 * POST /api/graph/import — the format-agnostic front door's transport
 * (vision §1, 2026-09-13): raw personal-notes files in, one extraction run
 * per file through the SAME pipeline the sessions use. Multipart form data
 * (field "files", any text format — the extractor is format-agnostic); the
 * pipeline mints a deterministic source id per file path, persists the
 * source record (the file's provenance + the run's usage), and runs
 * extractor → auditor → merger over the raw text.
 *
 * Small concurrency cap: the model calls are the slow part, and a burst of
 * 25 simultaneous runs would trip provider rate limits — a 3-wide worker
 * pool keeps the run registry (the dock's status chips) and the ledgers
 * healthy. The dock's chips + graph refetch track progress live through
 * /api/graph/status, as with session runs.
 */
import { addCopiedFile, classIdle, extraction, getClass, NotesImportError, requestClassScope } from "@/src/server";
import type { EmissionStats } from "@/src/core";

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
	const form = await request.formData();
	const files = form.getAll("files").filter((f): f is File => f instanceof File);
	if (files.length === 0) {
		return Response.json({ results: [] as ImportResult[], error: "no files" }, { status: 400 });
	}

	// Classes wave (2026-10-26): ?class=<id> imports into that class — each
	// file becomes a class file (study material) and runs through the class
	// file pipeline into the class's own graph. Absent / "none" = No class.
	const scope = requestClassScope(request);
	if (scope === undefined) return Response.json({ results: [] as ImportResult[], error: "No such class" }, { status: 404 });
	if (scope !== null) return Response.json({ results: await importIntoClass(scope, files) });

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
/** Class import: add each file as study material, wait for the class's
 *  file queue to drain, report each file's resulting state. */
async function importIntoClass(classId: string, files: File[]): Promise<ImportResult[]> {
	const added: { requestIndex: number; filePath: string; fileId?: string; error?: string }[] = [];
	for (const [requestIndex, file] of files.entries()) {
		const outcome = addCopiedFile(classId, file.name, new Uint8Array(await file.arrayBuffer()), "study");
		added.push(outcome.ok ? { requestIndex, filePath: file.name, fileId: outcome.value.id } : { requestIndex, filePath: file.name, error: outcome.error });
	}
	await classIdle(classId);
	const record = getClass(classId);
	return added.map(({ requestIndex, filePath, fileId, error }) => {
		const file = fileId ? record?.files.find((f) => f.id === fileId) : undefined;
		if (file?.status === "ready") return { requestIndex, filePath, ok: true, outcome: "completed" as const };
		return { requestIndex, filePath, ok: false, outcome: "failed" as const, error: error ?? file?.error ?? "Import did not finish" };
	});
}
