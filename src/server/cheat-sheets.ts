/**
 * CHEAT SHEETS — the one writer of a deadline's cheat sheet
 * (store/cheat-sheets.ts) and the requests behind it.
 *
 * Every prompt is a background work item on the single-submit seam
 * (agent/subagents/cheat-sheet-writer.ts), like the topic grouper: a
 * one-off that hands back the whole sheet, not a conversation, so it stays
 * out of the Talk chat. The agent makes a PDF in the sheet's working
 * folder (the godspeed folder's cheat-sheets/<class deadline>/, so its
 * source is there for the next change); the PDF is copied into the app's
 * data, so nothing here depends on that folder afterwards. One request at
 * a time per sheet. Each change goes out as "cheat-sheet-changed"; the
 * studio fetches the view again.
 */
import fs from "node:fs";
import path from "node:path";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { AttachmentPart, ChatAttachment } from "../core/attachments.ts";
import {
	PROMPT_MAX,
	cheatSheetRequestText,
	currentVersion,
	mistakeCounts,
	newCheatSheet,
	sheetFolderName,
	sheetCards,
	sheetMistakes,
	withPrompt,
	withVersion,
	type CheatSheet,
	type CheatSheetView,
	type ClassSheetsView,
	type RequestTopic,
	type SheetMistake,
} from "../core/cheat-sheet.ts";
import { emit } from "../core/events.ts";
import { ChatInputError } from "../core/input-events.ts";
import { topicFacts, topicStatus } from "../core/progress.ts";
import { localDay } from "../core/today-note.ts";
import { agentEngine, type PiEngine } from "../agent/models.ts";
import { searchTools } from "../agent/tools/class.ts";
import { writeSheet } from "../agent/subagents/cheat-sheet-writer.ts";
import { uniqueName } from "../core/class-shortcuts.ts";
import { readCheatSheet, readSheetPdf, removeSheetPdfs, saveCheatSheetFile, saveSheetPdf, writeCheatSheet } from "../store/cheat-sheets.ts";
import { cheatSheetsDir } from "./agent-folder.ts";
import { takeSheetPdf } from "./cheat-sheet-pdf.ts";
import { storeAttachments } from "./attachments.ts";
import { classMistakes, classOrderFor, progressFor } from "./progress.ts";
import { readPassage, searchClassFiles } from "./search-index.ts";
import { stores } from "./stores.ts";

/** Test seam: a scripted engine in place of the outside agent. */
export const cheatSheetSeams: { engine?: PiEngine } = {};

/** Facts sent per topic, to keep the request short. */
const FACTS_PER_TOPIC = 5;

/** A prompt as sent: the learner's words and their files, ready for the agent. */
interface Ask {
	text: string;
	files: string[];
	parts: AttachmentPart[];
}

interface Running {
	kind: "make" | "change";
	ask: Ask;
	controller: AbortController;
}

interface SheetState {
	runs: Map<string, Running>;
	/** The last failed request and why, for Try again. */
	failed: Map<string, { ask: Ask; error: string }>;
}

/** globalThis: Next can load this module more than once. */
function state(): SheetState {
	const g = globalThis as typeof globalThis & { __lhCheatSheets?: SheetState };
	return (g.__lhCheatSheets ??= { runs: new Map(), failed: new Map() });
}

type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const changed = (deadlineId: string) => emit("cheat-sheet-changed", { deadlineId });

const NEWER = "A newer godspeed saved this cheat sheet. Update godspeed to change it.";

/** Everything one request needs: the class, the deadline, its topics. */
interface Context {
	classId: string;
	className: string;
	classNotes: string;
	infoFiles: string[];
	deadline: { id: string; name: string; date: string };
	/** The deadline's topics in class order. */
	topics: RequestTopic[];
	mistakes: SheetMistake[];
	/** The saved sheet, or null. */
	saved: CheatSheet | "newer" | null;
}

function contextFor(classId: string, deadlineId: string): Outcome<Context> {
	const record = stores.classStore.getClass(classId);
	const deadline = record?.deadlines?.find((d) => d.id === deadlineId);
	const progress = record && deadline ? progressFor(classId) : null;
	const due = progress?.deadlines.find((d) => d.id === deadlineId);
	if (!record || !deadline || !progress || !due) return fail(404, "No such deadline");
	const order = classOrderFor(classId, progress);
	const rank = (topicId: string) => Math.min(...(progress.topics.find((t) => t.id === topicId)?.members.map((id) => order.get(id) ?? Infinity) ?? [Infinity]));
	const ids = [...due.topicIds].sort((a, b) => rank(a) - rank(b));
	const all = classMistakes(classId, progress);
	const counts = mistakeCounts(all, ids);
	const topics = ids.map((id) => {
		const t = progress.topics.find((x) => x.id === id)!;
		return {
			id,
			name: t.name,
			status: topicStatus(t.rate),
			mistakes: counts.get(id) ?? 0,
			facts: topicFacts(progress.facts, t)
				.slice(0, FACTS_PER_TOPIC)
				.map((f) => ({ name: f.name, statement: f.statement })),
		};
	});
	return {
		ok: true,
		value: {
			classId,
			className: record.name,
			classNotes: record.description,
			infoFiles: (record.files ?? []).filter((f) => f.kind === "info").map((f) => f.name),
			deadline: { id: deadline.id, name: deadline.name, date: deadline.date },
			topics,
			mistakes: sheetMistakes(all, ids),
			saved: readCheatSheet(classId, deadlineId),
		},
	};
}

/** The latest saved sheet, or a new one. */
function sheetNow(ctx: Context): CheatSheet {
	const now = readCheatSheet(ctx.classId, ctx.deadline.id);
	return now && now !== "newer" ? now : newCheatSheet(ctx.deadline.id, new Date().toISOString());
}

/** GET: the studio's view. */
export function cheatSheetView(classId: string, deadlineId: string): Outcome<CheatSheetView> {
	const got = contextFor(classId, deadlineId);
	if (!got.ok) return got;
	const ctx = got.value;
	const s = state();
	const run = s.runs.get(deadlineId);
	return {
		ok: true,
		value: {
			className: ctx.className,
			deadlineName: ctx.deadline.name,
			date: ctx.deadline.date,
			sheet: ctx.saved && ctx.saved !== "newer" ? ctx.saved : newCheatSheet(deadlineId, new Date().toISOString()),
			running: run ? { kind: run.kind, prompt: run.ask.text } : null,
			error: s.failed.get(deadlineId)?.error ?? null,
			...(ctx.saved === "newer" ? { newer: true as const } : {}),
		},
	};
}

function engine(): PiEngine {
	return cheatSheetSeams.engine ?? agentEngine();
}

/** The sheet's working folder, made if missing: the one it was given at
 *  its first request, else a new one named for the class and deadline. */
function workingFolder(ctx: Context, sheet: CheatSheet): { sheet: CheatSheet; path: string; files: string[] } {
	const root = cheatSheetsDir();
	fs.mkdirSync(root, { recursive: true });
	const taken = new Set(fs.readdirSync(root).map((n) => n.toLowerCase()));
	const name = sheet.folder ?? uniqueName(sheetFolderName(ctx.className, ctx.deadline.name), taken);
	const dir = path.join(root, name);
	fs.mkdirSync(dir, { recursive: true });
	const files = fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
	return { sheet: sheet.folder ? sheet : { ...sheet, folder: name }, path: dir, files };
}

/** Run one request: the agent makes the whole sheet as a PDF (a new one,
 *  or the current one changed), kept as the newest version with the
 *  prompt. Refused while another runs; its end is announced. */
function startRun(ctx: Context, ask: Ask): Outcome<null> {
	const s = state();
	const id = ctx.deadline.id;
	if (s.runs.has(id)) return fail(409, "Your agent is still working on this cheat sheet.");
	if (ctx.saved === "newer") return fail(409, NEWER);
	let folder: ReturnType<typeof workingFolder>;
	try {
		folder = workingFolder(ctx, sheetNow(ctx));
	} catch (err) {
		return fail(500, `Couldn't make the cheat sheet's folder: ${(err as Error).message}`);
	}
	// Saved now, so a retry or a renamed deadline keeps the same folder.
	if (folder.sheet.folder !== ctx.saved?.folder) writeCheatSheet(ctx.classId, folder.sheet);
	const current = currentVersion(folder.sheet);
	const controller = new AbortController();
	s.runs.set(id, { kind: current ? "change" : "make", ask, controller });
	s.failed.delete(id);
	changed(id);
	const text = cheatSheetRequestText({
		title: `${ctx.className} ${ctx.deadline.name}`,
		date: ctx.deadline.date,
		classNotes: ctx.classNotes,
		infoFiles: ctx.infoFiles,
		prompt: ask.text || "Use the files I sent.",
		earlier: folder.sheet.prompts,
		topics: ctx.topics,
		mistakes: ctx.mistakes,
		folder: { path: folder.path, files: folder.files },
		current,
	});
	const prompt: UserMessage["content"] = ask.parts.length > 0 ? [{ type: "text", text }, ...ask.parts] : text;
	const lookups = Object.values(searchTools({ searchFiles: (query, limit) => searchClassFiles(ctx.classId, query, limit), readPassage: (ref) => readPassage(ctx.classId, ref) }));
	const takePdf = (pdfPath: string) => takeSheetPdf(folder.path, pdfPath);
	void writeSheet({ title: `${ctx.className} ${ctx.deadline.name}`, prompt, lookups, takePdf, engine: engine(), signal: controller.signal })
		.then((pdf) => {
			const at = new Date().toISOString();
			const asked = withPrompt(sheetNow(ctx), { text: ask.text, at, ...(ask.files.length > 0 ? { files: ask.files } : {}) });
			const next = withVersion(asked, { prompt: ask.text, at, pages: pdf.pages, file: pdf.file });
			saveSheetPdf(ctx.classId, id, currentVersion(next.sheet)!.n, pdf.bytes);
			writeCheatSheet(ctx.classId, next.sheet);
			removeSheetPdfs(ctx.classId, id, next.dropped);
		})
		.catch((err: unknown) => {
			if (controller.signal.aborted) return;
			console.error(`[cheat-sheet ${id}] request failed:`, err);
			s.failed.set(id, { ask, error: err instanceof Error ? err.message : "the request failed" });
		})
		.finally(() => {
			s.runs.delete(id);
			changed(id);
		});
	return { ok: true, value: null };
}

/** Show in Finder: where a version's PDF is in the sheet's working folder.
 *  The agent's file while it is still that version, else godspeed's copy
 *  written there as "cheat sheet v<n>.pdf". */
export function sheetPdfFile(classId: string, deadlineId: string, n: number): Outcome<string> {
	const saved = readCheatSheet(classId, deadlineId);
	const version = saved && saved !== "newer" ? saved.versions.find((v) => v.n === n) : null;
	const bytes = saved && saved !== "newer" && version ? cheatSheetPdf(classId, deadlineId, n) : null;
	if (!saved || saved === "newer" || !version || !bytes || !saved.folder) return fail(404, "No such cheat sheet");
	const same = (file: string) => {
		try {
			return fs.readFileSync(file).equals(bytes);
		} catch {
			return false;
		}
	};
	if (version.file && same(version.file)) return { ok: true, value: version.file };
	const dir = path.join(cheatSheetsDir(), saved.folder);
	const copy = path.join(dir, `cheat sheet v${n}.pdf`);
	if (!same(copy)) {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(copy, bytes);
	}
	return { ok: true, value: copy };
}

/** GET the class's Cheat sheets page: each deadline and where its sheet is. */
export function classSheetsView(classId: string): Outcome<ClassSheetsView> {
	const record = stores.classStore.getClass(classId);
	if (!record) return fail(404, "No such class");
	const runs = state().runs;
	const cards = sheetCards(record.deadlines ?? [], (id) => readCheatSheet(classId, id), (id) => runs.has(id), localDay());
	return { ok: true, value: { className: record.name, cards } };
}

/** A version's PDF, as the agent made it; null when there is none. */
export function cheatSheetPdf(classId: string, deadlineId: string, n: number): Buffer | null {
	return stores.classStore.getClass(classId)?.deadlines?.some((d) => d.id === deadlineId) ? readSheetPdf(classId, deadlineId, n) : null;
}

/** A prompt from the studio: make the sheet, or change it. Pictures go to
 *  the agent as pictures, PDFs are saved beside the sheet for it to read. */
export async function askCheatSheet(classId: string, deadlineId: string, input: { text: string; attachments?: readonly ChatAttachment[] }): Promise<Outcome<null>> {
	const text = input.text.trim();
	const attachments = input.attachments ?? [];
	if (!text && attachments.length === 0) return fail(400, "Say what you want on it.");
	if (text.length > PROMPT_MAX) return fail(400, `Keep it under ${PROMPT_MAX} characters.`);
	const got = contextFor(classId, deadlineId);
	if (!got.ok) return got;
	if (state().runs.has(deadlineId)) return fail(409, "Your agent is still working on this cheat sheet.");
	let parts: AttachmentPart[];
	try {
		parts = await storeAttachments(attachments, (fileName, bytes) => saveCheatSheetFile(classId, deadlineId, fileName, bytes));
	} catch (err) {
		if (err instanceof ChatInputError) return fail(400, err.message);
		throw err;
	}
	return startRun(got.value, { text, files: attachments.map((a) => a.name), parts });
}

/** Try again: the request that failed, sent again as it was. */
export function retryCheatSheet(classId: string, deadlineId: string): Outcome<null> {
	const failed = state().failed.get(deadlineId);
	if (!failed) return fail(409, "Nothing to try again.");
	const got = contextFor(classId, deadlineId);
	return got.ok ? startRun(got.value, failed.ask) : got;
}

/** Stop the request the agent is working on. */
export function stopCheatSheet(deadlineId: string): void {
	state().runs.get(deadlineId)?.controller.abort();
}

/** Resolves when no request for the sheet is going (tests). */
export async function cheatSheetIdle(deadlineId: string): Promise<void> {
	while (state().runs.has(deadlineId)) await new Promise((r) => setTimeout(r, 5));
}
