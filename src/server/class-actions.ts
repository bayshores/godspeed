/**
 * The class tools' work, shared by the outside agent's MCP server and the
 * Talk chat: each checks its arguments, changes the class through
 * classes.ts, records what it changed for the teacher's panel, and returns
 * what the agent sees. `caller` names the agent in the panel's rows.
 */
import { cleanSignature, type ClassDeadline, type ClassFileStatus } from "../core/contracts.ts";
import type { ClassActions, ClassChange, ToolOutcome } from "../core/class-tools.ts";
import { localDay } from "../core/today-note.ts";
import { stores } from "./stores.ts";
import { addClassDeadline, addFileFromPath, createClass, linkFolder, removeClassDeadline, setFileKind, updateClass, updateClassDeadline } from "./classes.ts";
import { classFilePath, classTopics } from "./class-card.ts";
import { fileExtents, readPassage, searchClassFiles } from "./search-index.ts";
import { noteAgentAction, type AgentActionInput } from "./agent-actions.ts";
import { shortcutPathProblem } from "./agent-folder.ts";
import { SIGNATURE_MAX } from "../core/contracts.ts";

/** Study files are read by the agent itself, as background work items. */
export const READING_NOTE = "The reading work comes to you through wait_for_work; it does not progress until you run the loop.";

/** This computer's date and time, "YYYY-MM-DD HH:MM" (deadlines are in
 *  the same local wall clock). */
function localNow(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${localDay(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** A class as agents see it: summary, file counts by status (and the
 *  files that could not be read, or every file with `withFiles`), the
 *  graph's topics, deadlines, lessons. A linked folder can hold 500 files,
 *  so the full list comes only on request. */
function classView(classId: string, withFiles = false) {
	const record = stores.classStore.getClass(classId);
	if (!record) return null;
	const sizes = withFiles ? fileExtents(record.id) : {};
	const fileCounts: Partial<Record<ClassFileStatus, number>> = {};
	for (const f of record.files) fileCounts[f.status] = (fileCounts[f.status] ?? 0) + 1;
	return {
		id: record.id,
		name: record.name,
		description: record.description,
		signature: record.signature ?? null,
		icon: record.icon ?? null,
		archived: record.archived,
		linkedFolder: record.linkedFolder ?? null,
		fileCounts,
		...(withFiles
			? {
					files: record.files.map((f) => ({
						id: f.id,
						name: f.name,
						kind: f.kind,
						origin: f.origin,
						status: f.status,
						...(f.error ? { error: f.error } : {}),
						...(sizes[f.id] ? { size: sizes[f.id] } : {}),
						path: classFilePath(record, f),
					})),
				}
			: {
					failedFiles: record.files
						.filter((f) => f.status === "failed" || f.status === "needs-whisper")
						.map((f) => ({ id: f.id, name: f.name, status: f.status, ...(f.error ? { error: f.error } : {}) })),
				}),
		topics: classTopics(record.id),
		today: localNow(),
		deadlines: (record.deadlines ?? []).map((d) => ({
			id: d.id,
			kind: d.kind,
			name: d.name,
			date: d.date,
			...(d.time !== undefined ? { time: d.time } : {}),
			done: d.done,
			files: d.fileIds.map((id) => ({ id, name: record.files.find((f) => f.id === id)?.name ?? id })),
		})),
		lessons: stores.chatStore
			.listChats()
			.filter((c) => c.classId === record.id)
			.map((c) => ({ id: c.id, title: c.title, kind: c.kind, updatedAt: c.updatedAt })),
	};
}

function deadlineName(classId: string, deadlineId: string): string {
	return stores.classStore.getClass(classId)?.deadlines?.find((d) => d.id === deadlineId)?.name ?? "a deadline";
}

export function folderName(path: string | undefined): string {
	return path?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "a folder";
}

const noClass = (classId: string): ToolOutcome => ({ ok: false, error: `No class "${classId}". Use list_classes.` });
const badSignature: ToolOutcome = { ok: false, error: `A signature is one line of at most ${SIGNATURE_MAX} characters.` };

export function classActions(caller: string | undefined): ClassActions {
	// Each change is recorded for the panel and returned for the chat.
	const done = (value: unknown, changes: AgentActionInput[] = []): ToolOutcome => {
		for (const change of changes) noteAgentAction(caller, change);
		return { ok: true, value, changes: changes.map((c): ClassChange => ({ label: c.label, page: c.page })) };
	};
	return {
		list_classes() {
			const lessons = stores.chatStore.listChats();
			const classes = stores.classStore.listClasses().map((c) => ({
				id: c.id,
				name: c.name,
				description: c.description,
				icon: c.icon ?? null,
				archived: c.archived,
				linkedFolder: c.linkedFolder ?? null,
				files: c.fileCount,
				lessons: lessons.filter((l) => l.classId === c.id).length,
			}));
			return done({ classes, noClassLessons: lessons.filter((l) => !l.classId).length });
		},

		read_class({ class_id, files }) {
			const view = classView(class_id, files);
			return view ? done(view) : noClass(class_id);
		},

		async search_class_files({ class_id, query, limit }) {
			if (!stores.classStore.getClass(class_id)) return noClass(class_id);
			try {
				return done(await searchClassFiles(class_id, query, limit ?? 8));
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : String(err) };
			}
		},

		read_passage({ class_id, passage_id, file_id, range }) {
			if (!stores.classStore.getClass(class_id)) return noClass(class_id);
			if (passage_id) return done(readPassage(class_id, { passageId: passage_id }));
			if (file_id && range) return done(readPassage(class_id, { fileId: file_id, range }));
			return { ok: false, error: "Give passage_id, or file_id with range." };
		},

		create_class({ name, description, signature, icon }) {
			const sig = signature ? cleanSignature(signature) : undefined;
			if (sig === null) return badSignature;
			const created = createClass({ name, description, icon, ...(sig ? { signature: sig } : {}) });
			return done({ class: classView(created.id) }, [
				{ label: `Creating ${created.name}`, classId: created.id, target: { kind: "class", id: created.id }, page: "/class" },
			]);
		},

		update_class({ class_id, name, description, signature, icon, archived }) {
			const sig = signature ? cleanSignature(signature) : undefined;
			if (sig === null) return badSignature;
			const outcome = updateClass(class_id, { name, description, archived, ...(icon ? { icon } : {}), ...(sig ? { signature: sig } : {}) });
			if (!outcome.ok) return outcome;
			const cls = outcome.value;
			const verb = archived === true ? "Archiving" : archived === false ? "Unarchiving" : "Updating";
			const given = { name, description, signature: sig, icon, archived };
			const changed = (Object.keys(given) as (keyof typeof given)[]).filter((key) => given[key] !== undefined);
			return done({ classId: class_id, changed: Object.fromEntries(changed.map((key) => [key, cls[key]])) }, [
				{ label: `${verb} ${cls.name}`, classId: class_id, target: { kind: "class", id: class_id }, page: "/class" },
			]);
		},

		add_class_file({ class_id, path, kind }) {
			const problem = shortcutPathProblem(path);
			if (problem) return { ok: false, error: problem };
			const outcome = addFileFromPath(class_id, path, kind);
			if (!outcome.ok) return outcome;
			return done({ file: outcome.value, note: kind === "study" ? `Added. ${READING_NOTE}` : "Added." }, [
				{ label: `Adding ${outcome.value.name}`, classId: class_id, target: { kind: "file", id: outcome.value.id }, page: "/class/files" },
			]);
		},

		set_class_file_kind({ class_id, file_ids, kind }) {
			if (!stores.classStore.getClass(class_id)) return noClass(class_id);
			const files: { id: string; name: string; kind: string; status: string }[] = [];
			const refused: { fileId: string; error: string }[] = [];
			const changes: AgentActionInput[] = [];
			for (const fileId of file_ids) {
				const outcome = setFileKind(class_id, fileId, kind);
				if (!outcome.ok) {
					refused.push({ fileId, error: outcome.error });
					continue;
				}
				const { id, name, status } = outcome.value;
				files.push({ id, name, kind, status });
				changes.push({ label: `Marking ${name} as ${kind === "study" ? "study material" : "course info"}`, classId: class_id, target: { kind: "file", id }, page: "/class/files" });
			}
			if (files.length === 0) return { ok: false, error: refused.map((r) => `${r.fileId}: ${r.error}`).join("\n") };
			return done({ files, ...(refused.length ? { refused } : {}) }, changes);
		},

		add_class_deadline({ class_id, deadlines }) {
			if (!stores.classStore.getClass(class_id)) return noClass(class_id);
			const added: ClassDeadline[] = [];
			const refused: { name: string; error: string }[] = [];
			for (const { kind, name, date, time, file_ids } of deadlines) {
				const outcome = addClassDeadline(class_id, { kind, name, date, ...(time !== undefined ? { time } : {}), ...(file_ids ? { fileIds: file_ids } : {}) });
				if (!outcome.ok) refused.push({ name, error: outcome.error });
				else added.push(outcome.value);
			}
			if (added.length === 0) return { ok: false, error: refused.map((r) => `${r.name}: ${r.error}`).join("\n") };
			return done(
				{ deadlines: added, ...(refused.length ? { refused } : {}) },
				added.map((d) => ({ label: `Adding ${d.name}`, classId: class_id, target: { kind: "deadline" as const, id: d.id }, page: "/" })),
			);
		},

		update_class_deadline({ class_id, deadline_id, kind, name, date, time, file_ids, done: isDone }) {
			const outcome = updateClassDeadline(class_id, deadline_id, {
				...(kind !== undefined ? { kind } : {}),
				...(name !== undefined ? { name } : {}),
				...(date !== undefined ? { date } : {}),
				...(time !== undefined ? { time } : {}),
				...(file_ids !== undefined ? { fileIds: file_ids } : {}),
				...(isDone !== undefined ? { done: isDone } : {}),
			});
			if (!outcome.ok) return outcome;
			const moved = (date !== undefined || time !== undefined) && kind === undefined && name === undefined && file_ids === undefined && isDone === undefined;
			const label =
				isDone === true
					? `Marking ${outcome.value.name} done`
					: isDone === false
						? `Marking ${outcome.value.name} not done`
						: `${moved ? "Moving" : "Changing"} ${outcome.value.name}`;
			return done({ deadline: outcome.value }, [{ label, classId: class_id, target: { kind: "deadline", id: deadline_id }, page: "/" }]);
		},

		remove_class_deadline({ class_id, deadline_id }) {
			const removedName = deadlineName(class_id, deadline_id);
			const outcome = removeClassDeadline(class_id, deadline_id);
			if (!outcome.ok) return outcome;
			return done({ removed: deadline_id }, [
				{ label: `Removing ${removedName}`, classId: class_id, target: { kind: "deadline", id: deadline_id }, page: "/", removed: true },
			]);
		},

		link_class_folder({ class_id, path }) {
			const problem = shortcutPathProblem(path);
			if (problem) return { ok: false, error: problem };
			const outcome = linkFolder(class_id, path);
			if (!outcome.ok) return outcome;
			return done({ class: classView(class_id), note: `Linked. ${READING_NOTE}` }, [
				{ label: `Linking ${folderName(path)}`, classId: class_id, target: { kind: "class", id: class_id }, page: "/class/files" },
			]);
		},
	};
}
