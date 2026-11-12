/**
 * The space tools' work, shared by the outside agent's MCP server and the
 * Talk chat: each checks its arguments, changes the space through
 * spaces.ts, records what it changed for the teacher's panel, and returns
 * what the agent sees. `caller` names the agent in the panel's rows.
 * `send` gives a new lesson its first message (the chat handler's input,
 * passed in so this file doesn't import it back).
 */
import { cleanSignature, parseSpaceScope, type SpaceDeadline, type SpaceFileStatus } from "../../shared/core/contracts.ts";
import type { SpaceActions, SpaceChange, ToolOutcome } from "../../shared/core/space-tools.ts";
import { localDay } from "../../shared/core/today-note.ts";
import { stores } from "./stores.ts";
import { addSpaceDeadline, addFileFromPath, createSpace, linkFolder, removeSpaceDeadline, setFileKind, updateSpace, updateSpaceDeadline } from "./spaces.ts";
import { spaceFilePath, spaceTopics } from "./space-card.ts";
import { fileExtents, readPassage, searchSpaceFiles } from "./search-index.ts";
import { noteAgentAction, type AgentActionInput } from "./agent-actions.ts";
import { shortcutPathProblem } from "./agent-folder.ts";
import { createLesson } from "./lessons.ts";
import { SIGNATURE_MAX } from "../../shared/core/contracts.ts";

/** Study files are read by the agent itself, as background work items. */
export const READING_NOTE = "The reading work comes to you through wait_for_work; it does not progress until you run the loop.";

/** This computer's date and time, "YYYY-MM-DD HH:MM" (deadlines are in
 *  the same local wall clock). */
function localNow(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${localDay(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** A space as agents see it: summary, file counts by status (and the
 *  files that could not be read, or every file with `withFiles`), the
 *  graph's topics, deadlines, lessons. A linked folder can hold 500 files,
 *  so the full list comes only on request. */
function spaceView(spaceId: string, withFiles = false) {
	const record = stores.spaceStore.getSpace(spaceId);
	if (!record) return null;
	const sizes = withFiles ? fileExtents(record.id) : {};
	const fileCounts: Partial<Record<SpaceFileStatus, number>> = {};
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
						path: spaceFilePath(record, f),
					})),
				}
			: {
					failedFiles: record.files
						.filter((f) => f.status === "failed" || f.status === "needs-whisper")
						.map((f) => ({ id: f.id, name: f.name, status: f.status, ...(f.error ? { error: f.error } : {}) })),
				}),
		topics: spaceTopics(record.id),
		today: localNow(),
		deadlines: (record.deadlines ?? []).map((d) => ({
			id: d.id,
			kind: d.kind,
			name: d.name,
			date: d.date,
			...(d.time !== undefined ? { time: d.time } : {}),
			done: d.done,
			files: d.fileIds.map((id) => ({ id, name: record.files.find((f) => f.id === id)?.name ?? id })),
			...(d.leftOutIds ? { leftOut: d.leftOutIds.map((id) => ({ id, name: record.files.find((f) => f.id === id)?.name ?? id })) } : {}),
			...(d.source ? { source: d.source } : {}),
		})),
		lessons: stores.chatStore
			.listChats()
			.filter((c) => c.spaceId === record.id)
			.map((c) => ({ id: c.id, title: c.title, kind: c.kind, updatedAt: c.updatedAt })),
	};
}

function deadlineName(spaceId: string, deadlineId: string): string {
	return stores.spaceStore.getSpace(spaceId)?.deadlines?.find((d) => d.id === deadlineId)?.name ?? "a deadline";
}

export function folderName(path: string | undefined): string {
	return path?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "a folder";
}

const noSpace = (spaceId: string): ToolOutcome => ({ ok: false, error: `No space "${spaceId}". Use list_spaces.` });
const badSignature: ToolOutcome = { ok: false, error: `A signature is one line of at most ${SIGNATURE_MAX} characters.` };

/** Sends a lesson's first message. */
type SendFirstMessage = (chatId: string, text: string) => Promise<Response>;

/** `openStarted`: the learner asked for the lesson or the space in Talk, so
 *  the window opens it even with Follow off. */
export function spaceActions(caller: string | undefined, send: SendFirstMessage, opts: { openStarted: boolean }): SpaceActions {
	// Each change is recorded for the panel and returned for the chat.
	const done = (value: unknown, changes: AgentActionInput[] = []): ToolOutcome => {
		for (const change of changes) noteAgentAction(caller, change);
		return { ok: true, value, changes: changes.map((c): SpaceChange => ({ label: c.label, page: c.page })) };
	};
	return {
		list_spaces() {
			const lessons = stores.chatStore.listChats();
			const spaces = stores.spaceStore.listSpaces().map((c) => ({
				id: c.id,
				name: c.name,
				description: c.description,
				icon: c.icon ?? null,
				archived: c.archived,
				linkedFolder: c.linkedFolder ?? null,
				files: c.fileCount,
				lessons: lessons.filter((l) => l.spaceId === c.id).length,
			}));
			return done({ spaces, noSpaceLessons: lessons.filter((l) => !l.spaceId).length });
		},

		read_space({ space_id, files }) {
			const view = spaceView(space_id, files);
			return view ? done(view) : noSpace(space_id);
		},

		async search_space_files({ space_id, query, limit }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			try {
				return done(await searchSpaceFiles(space_id, query, limit ?? 8));
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : String(err) };
			}
		},

		read_passage({ space_id, passage_id, file_id, range }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			if (passage_id) return done(readPassage(space_id, { passageId: passage_id }));
			if (file_id && range) return done(readPassage(space_id, { fileId: file_id, range }));
			return { ok: false, error: "Give passage_id, or file_id with range." };
		},

		create_space({ name, description, signature, icon }) {
			const sig = signature ? cleanSignature(signature) : undefined;
			if (sig === null) return badSignature;
			const created = createSpace({ name, description, icon, ...(sig ? { signature: sig } : {}) });
			return done({ space: spaceView(created.id) }, [
				{ label: `Creating ${created.name}`, spaceId: created.id, target: { kind: "space", id: created.id }, page: "/space", ...(opts.openStarted ? { open: true as const } : {}) },
			]);
		},

		update_space({ space_id, name, description, signature, icon, archived }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			const sig = signature ? cleanSignature(signature) : undefined;
			if (sig === null) return badSignature;
			const outcome = updateSpace(space_id, { name, description, archived, ...(icon ? { icon } : {}), ...(sig ? { signature: sig } : {}) });
			if (!outcome.ok) return outcome;
			const space = outcome.value;
			const verb = archived === true ? "Archiving" : archived === false ? "Unarchiving" : "Updating";
			const given = { name, description, signature: sig, icon, archived };
			const changed = (Object.keys(given) as (keyof typeof given)[]).filter((key) => given[key] !== undefined);
			return done({ spaceId: space_id, changed: Object.fromEntries(changed.map((key) => [key, space[key]])) }, [
				{ label: `${verb} ${space.name}`, spaceId: space_id, target: { kind: "space", id: space_id }, page: "/space" },
			]);
		},

		add_space_file({ space_id, path, kind }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			const problem = shortcutPathProblem(path);
			if (problem) return { ok: false, error: problem };
			const outcome = addFileFromPath(space_id, path, kind);
			if (!outcome.ok) return outcome;
			return done({ file: outcome.value, note: kind === "study" ? `Added. ${READING_NOTE}` : "Added." }, [
				{ label: `Adding ${outcome.value.name}`, spaceId: space_id, target: { kind: "file", id: outcome.value.id }, page: "/space/files" },
			]);
		},

		set_space_file_kind({ space_id, file_ids, kind }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			const files: { id: string; name: string; kind: string; status: string }[] = [];
			const refused: { fileId: string; error: string }[] = [];
			const changes: AgentActionInput[] = [];
			for (const fileId of file_ids) {
				const outcome = setFileKind(space_id, fileId, kind);
				if (!outcome.ok) {
					refused.push({ fileId, error: outcome.error });
					continue;
				}
				const { id, name, status } = outcome.value;
				files.push({ id, name, kind, status });
				changes.push({ label: `Marking ${name} as ${kind === "study" ? "study material" : "space info"}`, spaceId: space_id, target: { kind: "file", id }, page: "/space/files" });
			}
			if (files.length === 0) return { ok: false, error: refused.map((r) => `${r.fileId}: ${r.error}`).join("\n") };
			return done({ files, ...(refused.length ? { refused } : {}) }, changes);
		},

		add_space_deadline({ space_id, deadlines }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			const added: SpaceDeadline[] = [];
			const refused: { name: string; error: string }[] = [];
			for (const { kind, name, date, time, file_ids, left_out_ids, source, assignment_file_id } of deadlines) {
				const outcome = addSpaceDeadline(space_id, {
					kind,
					name,
					date,
					...(time !== undefined ? { time } : {}),
					...(file_ids ? { fileIds: file_ids } : {}),
					...(left_out_ids ? { leftOutIds: left_out_ids } : {}),
					...(source !== undefined ? { source } : {}),
					...(assignment_file_id !== undefined ? { assignmentFileId: assignment_file_id } : {}),
				});
				if (!outcome.ok) refused.push({ name, error: outcome.error });
				else added.push(outcome.value);
			}
			if (added.length === 0) return { ok: false, error: refused.map((r) => `${r.name}: ${r.error}`).join("\n") };
			return done(
				{ deadlines: added, ...(refused.length ? { refused } : {}) },
				added.map((d) => ({ label: `Adding ${d.name}`, spaceId: space_id, target: { kind: "deadline" as const, id: d.id }, page: "/" })),
			);
		},

		update_space_deadline({ space_id, deadline_id, kind, name, date, time, file_ids, left_out_ids, source, assignment_file_id, done: isDone }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			const outcome = updateSpaceDeadline(space_id, deadline_id, {
				...(kind !== undefined ? { kind } : {}),
				...(name !== undefined ? { name } : {}),
				...(date !== undefined ? { date } : {}),
				...(time !== undefined ? { time } : {}),
				...(file_ids !== undefined ? { fileIds: file_ids } : {}),
				...(left_out_ids !== undefined ? { leftOutIds: left_out_ids } : {}),
				...(source !== undefined ? { source } : {}),
				...(assignment_file_id !== undefined ? { assignmentFileId: assignment_file_id } : {}),
				...(isDone !== undefined ? { done: isDone } : {}),
			});
			if (!outcome.ok) return outcome;
			const moved = (date !== undefined || time !== undefined) && kind === undefined && name === undefined && file_ids === undefined && left_out_ids === undefined && source === undefined && assignment_file_id === undefined && isDone === undefined;
			const label =
				isDone === true
					? `Marking ${outcome.value.name} done`
					: isDone === false
						? `Marking ${outcome.value.name} not done`
						: `${moved ? "Moving" : "Changing"} ${outcome.value.name}`;
			return done({ deadline: outcome.value }, [{ label, spaceId: space_id, target: { kind: "deadline", id: deadline_id }, page: "/" }]);
		},

		remove_space_deadline({ space_id, deadline_id }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			const removedName = deadlineName(space_id, deadline_id);
			const outcome = removeSpaceDeadline(space_id, deadline_id);
			if (!outcome.ok) return outcome;
			return done({ removed: deadline_id }, [
				{ label: `Removing ${removedName}`, spaceId: space_id, target: { kind: "deadline", id: deadline_id }, page: "/", removed: true },
			]);
		},

		link_space_folder({ space_id, path }) {
			if (!stores.spaceStore.getSpace(space_id)) return noSpace(space_id);
			const problem = shortcutPathProblem(path);
			if (problem) return { ok: false, error: problem };
			const outcome = linkFolder(space_id, path);
			if (!outcome.ok) return outcome;
			return done({ space: spaceView(space_id), note: `Linked. ${READING_NOTE}` }, [
				{ label: `Linking ${folderName(path)}`, spaceId: space_id, target: { kind: "space", id: space_id }, page: "/space/files" },
			]);
		},

		async start_lesson({ topic, space_id }) {
			const scope = parseSpaceScope(space_id);
			if (scope === undefined) return { ok: false, error: `"${space_id}" is not a space id. Use list_spaces.` };
			if (scope !== null) {
				const space = stores.spaceStore.getSpace(scope);
				if (!space) return noSpace(scope);
				if (space.archived) return { ok: false, error: "This space is archived. Ask the learner to unarchive it in Edit space first." };
			}
			const created = createLesson({ title: topic, spaceId: scope });
			if (!created.ok) return { ok: false, error: created.error };
			const chat = created.chat;
			const started = await send(chat.id, topic);
			if (!started.ok) return { ok: false, error: `The lesson was created but could not start: ${await started.text()}` };
			return done({ status: "started", lessonId: chat.id, title: chat.title }, [
				{ label: `Starting ${chat.title}`, spaceId: scope, target: { kind: "lesson", id: chat.id }, page: `/chat/${chat.id}`, ...(opts.openStarted ? { open: true as const } : {}) },
			]);
		},
	};
}
