/**
 * CHEAT SHEETS — the one writer of a deadline's cheat sheet
 * (store/cheat-sheets.ts) and the requests behind it.
 *
 * Each message in a sheet's chat is a background work item on the
 * single-submit seam (agent/subagents/cheat-sheet-writer.ts), like the
 * topic grouper: one request that carries the sheet's context and the last
 * few messages, so it stays out of the Talk chat and the lessons. The
 * agent answers, and may make or change the PDF in the sheet's working
 * folder (the godspeed folder's cheat-sheets/<space deadline>/, so its
 * source is there for the next change); the PDF is copied into the app's
 * data, so nothing here depends on that folder afterwards. A PDF changed
 * in that folder outside godspeed comes in as a new version when the sheet
 * is opened. One request at a time per sheet. Each change goes out as
 * "cheat-sheet-changed"; the studio fetches the view again.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UserMessage } from "@earendil-works/pi-ai";
import { isPdfType, pdfFileName, pdfNote, pdfNoteOf, type AttachmentPart, type ChatAttachment } from "../../shared/core/attachments.ts";
import {
	PROMPT_MAX,
	cheatSheetRequestText,
	currentVersion,
	mistakeCounts,
	newCheatSheet,
	newerFolderPdf,
	regionProblem,
	sheetFolderName,
	sheetCards,
	sheetMistakes,
	withMessage,
	withRules,
	withVersion,
	withoutRule,
	type CheatSheet,
	type CheatSheetView,
	type SpaceSheetsView,
	type RequestTopic,
	type SheetFile,
	type SheetMistake,
	type SheetRegion,
	type YouMessage,
} from "../../shared/core/cheat-sheet.ts";
import { emit } from "../../shared/core/events.ts";
import { ChatInputError } from "../../shared/core/input-events.ts";
import { topicFacts, topicStatus } from "../../shared/core/progress.ts";
import { localDay } from "../../shared/core/today-note.ts";
import { agentEngine, type PiEngine } from "../agent/models.ts";
import { searchTools } from "../agent/tools/space.ts";
import { replyOnSheet } from "../agent/subagents/cheat-sheet-writer.ts";
import { uniqueName } from "../../shared/core/space-shortcuts.ts";
import { readCheatSheet, readCheatSheetFile, readSheetPdf, removeSheetPdfs, saveCheatSheetFile, saveSheetPdf, writeCheatSheet } from "../store/cheat-sheets.ts";
import { cheatSheetsDir } from "./agent-folder.ts";
import { takeSheetPdf } from "./cheat-sheet-pdf.ts";
import { storeAttachments } from "./attachments.ts";
import { spaceMistakes, spaceOrderFor, progressFor } from "./progress.ts";
import { readPassage, searchSpaceFiles } from "./search-index.ts";
import { stores } from "./stores.ts";

/** Test seam: a scripted engine in place of the outside agent. */
export const cheatSheetSeams: { engine?: PiEngine } = {};

/** Facts sent per topic, to keep the request short. */
const FACTS_PER_TOPIC = 5;

interface SheetState {
	/** The message each sheet's agent is answering. */
	runs: Map<string, { messageId: string; controller: AbortController }>;
	/** The message the last request failed on and why, for Try again. */
	failed: Map<string, { messageId: string; error: string }>;
	/** Folder PDFs already looked at ("<path> <mtime>"), so each is read once. */
	folderSeen: Set<string>;
}

/** globalThis: Next can load this module more than once. */
function state(): SheetState {
	const g = globalThis as typeof globalThis & { __lhCheatSheets?: SheetState };
	return (g.__lhCheatSheets ??= { runs: new Map(), failed: new Map(), folderSeen: new Set() });
}

type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const changed = (deadlineId: string) => emit("cheat-sheet-changed", { deadlineId });

const NEWER = "A newer godspeed saved this cheat sheet. Update godspeed to change it.";
const BUSY = "Your agent is still answering your last message about this sheet.";

/** Everything one request needs: the space, the deadline, its topics. */
interface Context {
	spaceId: string;
	spaceName: string;
	spaceNotes: string;
	infoFiles: string[];
	deadline: { id: string; name: string; date: string };
	/** The deadline's topics in space order. */
	topics: RequestTopic[];
	mistakes: SheetMistake[];
	/** The saved sheet, or null. */
	saved: CheatSheet | "newer" | null;
}

function contextFor(spaceId: string, deadlineId: string): Outcome<Context> {
	const record = stores.spaceStore.getSpace(spaceId);
	const deadline = record?.deadlines?.find((d) => d.id === deadlineId);
	const progress = record && deadline ? progressFor(spaceId) : null;
	const due = progress?.deadlines.find((d) => d.id === deadlineId);
	if (!record || !deadline || !progress || !due) return fail(404, "No such deadline");
	const order = spaceOrderFor(spaceId, progress);
	const rank = (topicId: string) => Math.min(...(progress.topics.find((t) => t.id === topicId)?.members.map((id) => order.get(id) ?? Infinity) ?? [Infinity]));
	const ids = [...due.topicIds].sort((a, b) => rank(a) - rank(b));
	const all = spaceMistakes(spaceId, progress);
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
			spaceId,
			spaceName: record.name,
			spaceNotes: record.description,
			infoFiles: (record.files ?? []).filter((f) => f.kind === "info").map((f) => f.name),
			deadline: { id: deadline.id, name: deadline.name, date: deadline.date },
			topics,
			mistakes: sheetMistakes(all, ids),
			saved: readCheatSheet(spaceId, deadlineId),
		},
	};
}

/** The latest saved sheet, or a new one. */
function sheetNow(ctx: Context): CheatSheet {
	const now = readCheatSheet(ctx.spaceId, ctx.deadline.id);
	return now && now !== "newer" ? now : newCheatSheet(ctx.deadline.id, new Date().toISOString());
}

/** GET: the view the studio and the sheet beside a session show, after
 *  taking a newer PDF from the working folder. */
export async function cheatSheetView(spaceId: string, deadlineId: string): Promise<Outcome<CheatSheetView>> {
	let got = contextFor(spaceId, deadlineId);
	if (!got.ok) return got;
	if (await takeFolderPdf(got.value)) got = contextFor(spaceId, deadlineId);
	if (!got.ok) return got;
	const ctx = got.value;
	const s = state();
	const run = s.runs.get(deadlineId);
	const failed = s.failed.get(deadlineId);
	return {
		ok: true,
		value: {
			spaceName: ctx.spaceName,
			deadlineName: ctx.deadline.name,
			date: ctx.deadline.date,
			sheet: ctx.saved && ctx.saved !== "newer" ? ctx.saved : newCheatSheet(deadlineId, new Date().toISOString()),
			running: run ? { messageId: run.messageId } : null,
			error: failed ? { messageId: failed.messageId, text: failed.error } : null,
			...(ctx.saved === "newer" ? { newer: true as const } : {}),
		},
	};
}

/**
 * A PDF in the working folder newer than the current version (the learner
 * changed the sheet outside godspeed, say in their agent's own chat) is
 * kept as a new version, after the same checks as one the agent sends.
 * Not while the agent works on the sheet; each file is looked at once.
 * True when a version was added.
 */
async function takeFolderPdf(ctx: Context): Promise<boolean> {
	const s = state();
	const sheet = ctx.saved;
	if (!sheet || sheet === "newer" || !sheet.folder || s.runs.has(ctx.deadline.id)) return false;
	const dir = path.join(cheatSheetsDir(), sheet.folder);
	let files: { name: string; mtimeMs: number }[];
	try {
		files = fs.readdirSync(dir).flatMap((n) => {
			const stat = fs.statSync(path.join(dir, n), { throwIfNoEntry: false });
			return stat?.isFile() ? [{ name: n, mtimeMs: stat.mtimeMs }] : [];
		});
	} catch {
		return false;
	}
	const pick = newerFolderPdf(files, currentVersion(sheet));
	const mtime = files.find((f) => f.name === pick)?.mtimeMs;
	const key = `${dir}/${pick} ${mtime}`;
	if (!pick || s.folderSeen.has(key)) return false;
	s.folderSeen.add(key);
	const pdf = await takeSheetPdf(dir, pick);
	if (typeof pdf === "string") {
		console.warn(`[cheat-sheet ${ctx.deadline.id}] ${pick} in the working folder can't be the sheet: ${pdf}`);
		return false;
	}
	const now = sheetNow(ctx);
	const latest = currentVersion(now);
	if (latest && readSheetPdf(ctx.spaceId, ctx.deadline.id, latest.n)?.equals(pdf.bytes)) return false;
	const next = withVersion(now, { prompt: "", at: new Date().toISOString(), pages: pdf.pages, file: pdf.file, fromFolder: true });
	saveSheetPdf(ctx.spaceId, ctx.deadline.id, currentVersion(next.sheet)!.n, pdf.bytes);
	writeCheatSheet(ctx.spaceId, next.sheet);
	removeSheetPdfs(ctx.spaceId, ctx.deadline.id, next.dropped);
	return true;
}

function engine(): PiEngine {
	return cheatSheetSeams.engine ?? agentEngine();
}

/** The sheet's working folder, made if missing: the one it was given at
 *  its first request, else a new one named for the space and deadline. */
function workingFolder(ctx: Context, sheet: CheatSheet): { sheet: CheatSheet; path: string; files: string[] } {
	const root = cheatSheetsDir();
	fs.mkdirSync(root, { recursive: true });
	const taken = new Set(fs.readdirSync(root).map((n) => n.toLowerCase()));
	const name = sheet.folder ?? uniqueName(sheetFolderName(ctx.spaceName, ctx.deadline.name), taken);
	const dir = path.join(root, name);
	fs.mkdirSync(dir, { recursive: true });
	const files = fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
	return { sheet: sheet.folder ? sheet : { ...sheet, folder: name }, path: dir, files };
}

const PICTURE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg" };

/** A message's files as the agent reads them: pictures inline, PDFs as a
 *  note naming their path. Files that are gone are left out. */
function filesForAgent(spaceId: string, deadlineId: string, files: readonly SheetFile[]): AttachmentPart[] {
	return files.flatMap((f): AttachmentPart[] => {
		const saved = f.file ? readCheatSheetFile(spaceId, deadlineId, f.file) : null;
		if (!saved) return [];
		if (/\.pdf$/i.test(f.file!)) return [pdfNote(f.name, saved.path)];
		const mimeType = PICTURE_TYPES[f.file!.split(".").pop()!] ?? "image/png";
		return [{ type: "image", data: saved.bytes.toString("base64"), mimeType }];
	});
}

/** Run one request: the agent answers the message, maybe with a new PDF
 *  (kept as the newest version) and rules. Refused while another runs;
 *  its end is announced. */
function startRun(ctx: Context, messageId: string): Outcome<null> {
	const s = state();
	const id = ctx.deadline.id;
	if (s.runs.has(id)) return fail(409, BUSY);
	if (ctx.saved === "newer") return fail(409, NEWER);
	let folder: ReturnType<typeof workingFolder>;
	try {
		folder = workingFolder(ctx, sheetNow(ctx));
	} catch (err) {
		return fail(500, `Couldn't make the cheat sheet's folder: ${(err as Error).message}`);
	}
	// Saved now, so a retry or a renamed deadline keeps the same folder.
	if (folder.sheet.folder !== ctx.saved?.folder) writeCheatSheet(ctx.spaceId, folder.sheet);
	const index = folder.sheet.messages.findIndex((m) => m.id === messageId);
	const message = folder.sheet.messages[index];
	if (!message || message.role !== "you") return fail(409, "That message is gone.");
	const controller = new AbortController();
	s.runs.set(id, { messageId, controller });
	s.failed.delete(id);
	changed(id);
	const text = cheatSheetRequestText({
		title: `${ctx.spaceName} ${ctx.deadline.name}`,
		date: ctx.deadline.date,
		spaceNotes: ctx.spaceNotes,
		infoFiles: ctx.infoFiles,
		rules: folder.sheet.rules,
		topics: ctx.topics,
		mistakes: ctx.mistakes,
		folder: { path: folder.path, files: folder.files },
		versions: folder.sheet.versions,
		earlier: folder.sheet.messages.slice(0, index),
		message,
	});
	const parts = filesForAgent(ctx.spaceId, id, message.files ?? []);
	const prompt: UserMessage["content"] = parts.length > 0 ? [{ type: "text", text }, ...parts] : text;
	const lookups = Object.values(searchTools({ searchFiles: (query, limit) => searchSpaceFiles(ctx.spaceId, query, limit), readPassage: (ref) => readPassage(ctx.spaceId, ref) }));
	const takePdf = (pdfPath: string) => takeSheetPdf(folder.path, pdfPath);
	void replyOnSheet({ title: `${ctx.spaceName} ${ctx.deadline.name}`, prompt, lookups, takePdf, engine: engine(), signal: controller.signal })
		.then((reply) => {
			const at = new Date().toISOString();
			let sheet = sheetNow(ctx);
			let version: number | undefined;
			if (reply.pdf) {
				const next = withVersion(sheet, { prompt: message.text, at, pages: reply.pdf.pages, file: reply.pdf.file });
				version = currentVersion(next.sheet)!.n;
				saveSheetPdf(ctx.spaceId, id, version, reply.pdf.bytes);
				removeSheetPdfs(ctx.spaceId, id, next.dropped);
				sheet = next.sheet;
			}
			const kept = withRules(sheet, reply.rules, at);
			sheet = withMessage(kept.sheet, {
				id: randomUUID(),
				role: "agent",
				text: reply.text,
				at,
				...(version ? { version } : {}),
				...(kept.added.length > 0 ? { rules: kept.added } : {}),
			});
			writeCheatSheet(ctx.spaceId, { ...sheet, updatedAt: at });
		})
		.catch((err: unknown) => {
			if (controller.signal.aborted) return;
			console.error(`[cheat-sheet ${id}] request failed:`, err);
			s.failed.set(id, { messageId, error: err instanceof Error ? err.message : "the request failed" });
		})
		.finally(() => {
			s.runs.delete(id);
			changed(id);
		});
	return { ok: true, value: null };
}

/** Show in Finder: where a version's PDF is in the sheet's working folder.
 *  Its own file while it is still that version, else godspeed's copy
 *  written there as "cheat sheet v<n>.pdf". */
export function sheetPdfFile(spaceId: string, deadlineId: string, n: number): Outcome<string> {
	const saved = readCheatSheet(spaceId, deadlineId);
	const version = saved && saved !== "newer" ? saved.versions.find((v) => v.n === n) : null;
	const bytes = saved && saved !== "newer" && version ? cheatSheetPdf(spaceId, deadlineId, n) : null;
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

/** GET the space's Cheat sheets page: each deadline and where its sheet is. */
export function spaceSheetsView(spaceId: string): Outcome<SpaceSheetsView> {
	const record = stores.spaceStore.getSpace(spaceId);
	if (!record) return fail(404, "No such space");
	const runs = state().runs;
	const cards = sheetCards(record.deadlines ?? [], (id) => readCheatSheet(spaceId, id), (id) => runs.has(id), localDay());
	return { ok: true, value: { spaceName: record.name, cards } };
}

/** A version's PDF, as the agent made it; null when there is none. */
export function cheatSheetPdf(spaceId: string, deadlineId: string, n: number): Buffer | null {
	return stores.spaceStore.getSpace(spaceId)?.deadlines?.some((d) => d.id === deadlineId) ? readSheetPdf(spaceId, deadlineId, n) : null;
}

/** A picture or PDF sent in the sheet's chat, with its type; null when there is none. */
export function cheatSheetFile(spaceId: string, deadlineId: string, file: string): { bytes: Buffer; type: string } | null {
	const known = stores.spaceStore.getSpace(spaceId)?.deadlines?.some((d) => d.id === deadlineId);
	const saved = known ? readCheatSheetFile(spaceId, deadlineId, file) : null;
	if (!saved) return null;
	return { bytes: saved.bytes, type: /\.pdf$/i.test(file) ? "application/pdf" : (PICTURE_TYPES[file.split(".").pop()!] ?? "application/octet-stream") };
}

/** Keep a message's files beside the sheet: pictures resized as the
 *  lessons keep them, PDFs as sent. */
async function keepFiles(spaceId: string, deadlineId: string, attachments: readonly ChatAttachment[]): Promise<SheetFile[]> {
	const parts = await storeAttachments(attachments, (fileName, bytes) => saveCheatSheetFile(spaceId, deadlineId, fileName, bytes));
	return parts.map((part, i) => {
		const name = attachments[i]!.name;
		if (part.type === "text") return { name, file: path.basename(pdfNoteOf(part.text)?.path ?? "") };
		const bytes = Buffer.from(part.data, "base64");
		const hash = createHash("sha256").update(bytes).digest("hex");
		// Named like a kept PDF (content hash, cleaned name), with the picture's own type.
		const file = pdfFileName(name.replace(/\.\w+$/, ""), hash).replace(/\.pdf$/, part.mimeType === "image/png" ? ".png" : ".jpg");
		saveCheatSheetFile(spaceId, deadlineId, file, bytes);
		return { name, file };
	});
}

/** A message in the sheet's chat: kept, then the agent answers it.
 *  Pictures go to the agent as pictures (a region's picture first), PDFs
 *  as a note with their path. */
export async function askCheatSheet(
	spaceId: string,
	deadlineId: string,
	input: { text: string; attachments?: readonly ChatAttachment[]; region?: SheetRegion },
): Promise<Outcome<null>> {
	const text = input.text.trim();
	const attachments = input.attachments ?? [];
	if (!text && attachments.length === 0) return fail(400, "Say what you want to ask or change.");
	if (text.length > PROMPT_MAX) return fail(400, `Keep it under ${PROMPT_MAX} characters.`);
	if (attachments.some((a) => !isPdfType(a.mimeType) && !a.mimeType.startsWith("image/"))) return fail(400, "Send pictures or PDFs.");
	const got = contextFor(spaceId, deadlineId);
	if (!got.ok) return got;
	if (got.value.saved === "newer") return fail(409, NEWER);
	if (state().runs.has(deadlineId)) return fail(409, BUSY);
	const sheet = sheetNow(got.value);
	const regionWrong = input.region ? regionProblem(input.region, sheet.versions) : null;
	if (regionWrong) return fail(400, regionWrong);
	let files: SheetFile[];
	try {
		files = await keepFiles(spaceId, deadlineId, attachments);
	} catch (err) {
		if (err instanceof ChatInputError) return fail(400, err.message);
		throw err;
	}
	const message: YouMessage = {
		id: randomUUID(),
		role: "you",
		text,
		at: new Date().toISOString(),
		...(files.length > 0 ? { files } : {}),
		...(input.region ? { region: input.region } : {}),
	};
	writeCheatSheet(spaceId, withMessage(sheet, message));
	return startRun({ ...got.value, saved: readCheatSheet(spaceId, deadlineId) }, message.id);
}

/** Try again: the message the last request failed on, sent again. */
export function retryCheatSheet(spaceId: string, deadlineId: string): Outcome<null> {
	const failed = state().failed.get(deadlineId);
	if (!failed) return fail(409, "Nothing to try again.");
	const got = contextFor(spaceId, deadlineId);
	return got.ok ? startRun(got.value, failed.messageId) : got;
}

/** Stop the request the agent is working on. */
export function stopCheatSheet(deadlineId: string): void {
	state().runs.get(deadlineId)?.controller.abort();
}

/** Delete one of the sheet's rules. */
export function removeSheetRule(spaceId: string, deadlineId: string, text: string): Outcome<null> {
	const got = contextFor(spaceId, deadlineId);
	if (!got.ok) return got;
	if (got.value.saved === "newer") return fail(409, NEWER);
	const sheet = sheetNow(got.value);
	writeCheatSheet(spaceId, withoutRule(sheet, text));
	changed(deadlineId);
	return { ok: true, value: null };
}

/** Resolves when no request for the sheet is going (tests). */
export async function cheatSheetIdle(deadlineId: string): Promise<void> {
	while (state().runs.has(deadlineId)) await new Promise((r) => setTimeout(r, 5));
}
