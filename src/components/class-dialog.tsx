/**
 * THE CLASS DIALOG (classes wave 2026-10-26; redesigned 2026-10-27 —
 * docs/design/exports/edit-class-exams.html; exams became deadlines
 * 2026-10-28): create a class (name and description) or edit one — name,
 * description and its Deadlines — with Archive and Delete class in the
 * footer. The class's files live on the Files page (src/components/files/*).
 *
 * Deadline edits are drafts until Save (src/components/class-deadlines-model.ts
 * turns them into the deadline routes' writes). Every write goes to /api/classes/*;
 * the server announces classes-changed and the class list refetches.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import { useClasses } from "@/components/class-context";
import { DeadlinesEditor } from "@/components/class-deadlines";
import { deadlineWrites, draftProblem, draftsFrom, type DeadlineDraft } from "@/components/class-deadlines-model";
import { jsonInit, send, useClassRecord } from "@/components/files/class-files-api";
import type { ClassDeadline, ClassRecord } from "@/core";

type Mode = { kind: "create" } | { kind: "edit"; classId: string };

/** Exit motion (motion wave, owner 2026-10-26): the dialog stays mounted
 *  with its last `value` while it fades out. */
function useLastWhileClosing<T>(value: T | null) {
	const presence = usePresence(value !== null);
	const [last, setLast] = useState(value);
	if (value !== null && value !== last) setLast(value);
	return { mounted: presence.mounted, state: presence.state, shown: value ?? last };
}

export function ClassDialog({ mode, onClose }: { mode: Mode | null; onClose: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(mode);
	if (!mounted || !shown) return null;
	return createPortal(<ClassDialogInner mode={shown} onClose={onClose} state={state} />, document.body);
}

type MotionState = "open" | "closed";

const LABEL = "text-[13px] font-bold text-ink-2";
const FIELD =
	"w-full bg-black px-3 py-2.5 text-[14.5px] leading-[21px] text-ink border border-tone-2 placeholder:text-ink-3 focus:border-ink-3";

function ClassDialogInner({ mode, onClose, state }: { mode: Mode; onClose: () => void; state: MotionState }) {
	const { setActive } = useClasses();
	const classId = mode.kind === "edit" ? mode.classId : null;
	const { record, reload } = useClassRecord(classId);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [drafts, setDrafts] = useState<DeadlineDraft[]>([]);
	const [openDeadline, setOpenDeadline] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const newCount = useRef(0);

	// First load fills the fields; later refreshes keep your edits.
	const seeded = useRef(false);
	useEffect(() => {
		if (record && !seeded.current) {
			seeded.current = true;
			setName(record.name);
			setDescription(record.description);
			setDrafts(draftsFrom(record.deadlines));
		}
	}, [record]);

	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});
	useEffect(() => {
		if (state === "closed") return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose, state]);

	const call = async (url: string, init: RequestInit): Promise<unknown | null> => {
		setBusy(true);
		setError(null);
		const { error: failed, body } = await send(url, init);
		setBusy(false);
		if (failed) {
			setError(failed);
			return null;
		}
		return body;
	};

	const changeDeadline = useCallback((key: string, patch: Partial<Pick<DeadlineDraft, "kind" | "name" | "date" | "time" | "fileIds" | "done">>) => {
		setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
	}, []);
	const addDeadline = useCallback(() => {
		const key = `new-${++newCount.current}`;
		setDrafts((ds) => [...ds, { key, kind: "exam", name: "", date: "", time: "", fileIds: [], done: false }]);
		setOpenDeadline(key);
	}, []);
	const removeDeadline = useCallback((key: string) => {
		setDrafts((ds) => ds.filter((d) => d.key !== key));
	}, []);

	/** Save the deadline drafts: each write in turn; a created deadline
	 *  keeps its new id so a retried Save never adds it twice. */
	const saveDeadlines = async (current: ClassRecord): Promise<string | null> => {
		const base = `/api/classes/${encodeURIComponent(current.id)}/deadlines`;
		for (const w of deadlineWrites(current.deadlines, drafts)) {
			if (w.op === "remove") {
				const { error: failed } = await send(`${base}/${encodeURIComponent(w.id)}`, { method: "DELETE" });
				if (failed) return failed;
			} else if (w.op === "update") {
				const { error: failed } = await send(`${base}/${encodeURIComponent(w.id)}`, jsonInit("PUT", w.body));
				if (failed) return failed;
			} else {
				const { error: failed, body } = await send(base, jsonInit("POST", w.body));
				if (failed) return failed;
				const deadline = (body as { deadline?: ClassDeadline } | null)?.deadline;
				if (!deadline) continue;
				// A retried Save sees the new id; a ticked one then PUTs done.
				setDrafts((ds) => ds.map((d) => (d.key === w.key ? { ...d, id: deadline.id } : d)));
				if (w.done) {
					const { error: doneFailed } = await send(`${base}/${encodeURIComponent(deadline.id)}`, jsonInit("PUT", { done: true }));
					if (doneFailed) return doneFailed;
				}
			}
		}
		return null;
	};

	const save = async () => {
		if (name.trim() === "") {
			setError("A class needs a name.");
			return;
		}
		if (mode.kind === "create") {
			const body = (await call("/api/classes", jsonInit("POST", { name, description }))) as { class?: ClassRecord } | null;
			if (body?.class) {
				setActive(body.class.id);
				onClose();
			}
			return;
		}
		if (!record) return;
		const problem = draftProblem(drafts);
		if (problem) {
			setError(problem);
			return;
		}
		setBusy(true);
		setError(null);
		const { error: failed } = await send(`/api/classes/${encodeURIComponent(record.id)}`, jsonInit("PUT", { name, description }));
		const deadlinesFailed = failed ?? (await saveDeadlines(record));
		setBusy(false);
		if (deadlinesFailed) {
			setError(deadlinesFailed);
			void reload();
			return;
		}
		onClose();
	};

	const title = mode.kind === "create" ? "New class" : "Edit class";
	return (
		<div data-state={state} inert={state === "closed"} className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				data-testid="class-dialog"
				data-state={state}
				onClick={(e) => e.stopPropagation()}
				className="lh-dialog flex max-h-[85vh] w-[560px] max-w-[calc(100vw-2rem)] flex-col bg-panel shadow-[0_0_40px_#000000e6] outline outline-1 -outline-offset-1 outline-tone-2"
			>
				<div className="flex shrink-0 items-center justify-between px-5 py-[18px]">
					<h2 className="text-base font-bold text-ink">{title}</h2>
					<button type="button" aria-label="Close" data-testid="class-dialog-close" onClick={onClose} className="lh-press text-ink-2 hover:text-ink">
						<XIcon className="size-4" aria-hidden />
					</button>
				</div>

				<div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-5 pb-5">
					<label className="flex flex-col gap-1.5">
						<span className={LABEL}>Name</span>
						<input
							type="text"
							data-testid="class-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. MATH 20C – Calculus III"
							className={`h-10 ${FIELD}`}
							autoFocus
						/>
					</label>
					<label className="mt-2.5 flex flex-col gap-1.5">
						<span className={LABEL}>Description</span>
						<textarea
							data-testid="class-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
							placeholder="Level, textbook, the professor's notation, what exams look like… The teacher reads this."
							className={`min-h-[72px] resize-y ${FIELD}`}
						/>
					</label>

					{mode.kind === "edit" && record && (
						<div className="mt-2.5">
							<DeadlinesEditor
								drafts={drafts}
								files={record.files}
								openKey={openDeadline}
								disabled={busy}
								onOpen={setOpenDeadline}
								onChange={changeDeadline}
								onAdd={addDeadline}
								onRemove={removeDeadline}
							/>
						</div>
					)}

					{error && (
						<div role="alert" data-testid="class-dialog-error" className="mt-2.5 whitespace-pre-wrap border border-ans-wrong/50 px-3 py-2 text-[13px] text-ans-wrong">
							{error}
						</div>
					)}
				</div>

				{confirmDelete && record ? (
					<div data-testid="class-delete-confirm" className="flex shrink-0 flex-col gap-2 border-t border-tone-2 px-5 py-3.5 text-[13px]">
						<span className="text-sm font-bold text-ans-wrong">Delete {record.name}?</span>
						<span className="text-ink-2">
							This permanently removes the class, all its lessons, its copied files, and its knowledge graph. A linked folder on
							your computer is not touched. This cannot be undone.
						</span>
						<div className="flex justify-end gap-2">
							<button type="button" onClick={() => setConfirmDelete(false)} className="lh-press px-3 py-1.5 font-bold text-ink-2 hover:text-ink">
								Cancel
							</button>
							<button
								type="button"
								data-testid="class-delete-confirm-button"
								disabled={busy}
								onClick={() =>
									void call(`/api/classes/${record.id}`, { method: "DELETE" }).then((ok) => {
										if (ok) {
											setActive(null);
											onClose();
										}
									})
								}
								className="lh-press bg-ans-wrong px-3 py-1.5 font-bold text-white hover:bg-red-600 disabled:opacity-60"
							>
								Delete class
							</button>
						</div>
					</div>
				) : (
					<div className="flex shrink-0 items-center justify-between border-t border-tone-2 px-5 py-3.5">
						<div className="flex items-center gap-4">
							{mode.kind === "edit" && record && (
								<>
									<button
										type="button"
										data-testid="class-archive"
										disabled={busy}
										onClick={() =>
											void call(`/api/classes/${record.id}`, jsonInit("PUT", { archived: !record.archived })).then((ok) => {
												if (ok && !record.archived) {
													setActive(null);
													onClose();
												}
											})
										}
										className="lh-press text-[13.5px] font-bold text-ink-2 hover:text-ink disabled:opacity-60"
									>
										{record.archived ? "Unarchive" : "Archive"}
									</button>
									<button
										type="button"
										data-testid="class-delete"
										onClick={() => setConfirmDelete(true)}
										className="lh-press text-[13.5px] font-bold text-ans-wrong hover:text-red-400"
									>
										Delete class
									</button>
								</>
							)}
						</div>
						<button
							type="button"
							data-testid="class-save"
							disabled={busy}
							onClick={() => void save()}
							className="lh-press bg-ink px-4 py-[9px] text-sm font-extrabold text-black hover:bg-white disabled:opacity-60"
						>
							{mode.kind === "create" ? "Create class" : "Save"}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

/** "Move to class…" (owner ruling: lessons can move). The lesson's facts
 *  leave the old class graph and are rebuilt in the new one. */
export function MoveLessonDialog({
	lesson,
	onClose,
	onMoved,
}: {
	lesson: { id: string; title: string; classId?: string } | null;
	onClose: () => void;
	onMoved: (id: string, classId: string | null) => void;
}) {
	const { mounted, state, shown } = useLastWhileClosing(lesson);
	if (!mounted || !shown) return null;
	return createPortal(<MoveLessonInner lesson={shown} onClose={onClose} onMoved={onMoved} state={state} />, document.body);
}

function MoveLessonInner({
	lesson,
	onClose,
	onMoved,
	state,
}: {
	lesson: { id: string; title: string; classId?: string };
	onClose: () => void;
	onMoved: (id: string, classId: string | null) => void;
	state: MotionState;
}) {
	const { classes } = useClasses();
	const from = lesson.classId ?? null;
	const [target, setTarget] = useState<string | null>(from);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});
	const move = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/chats/${lesson.id}/class`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ classId: target ?? "none" }),
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setError(body.error ?? `Move failed (${res.status})`);
				return;
			}
			onMoved(lesson.id, target);
		} catch {
			setError("Network error. Try again.");
		} finally {
			setBusy(false);
		}
	};
	const options: { id: string | null; name: string }[] = [
		...classes.filter((c) => !c.archived || c.id === from).map((c) => ({ id: c.id as string | null, name: c.name })),
		{ id: null, name: "No class" },
	];
	return (
		<div data-state={state} inert={state === "closed"} className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Move lesson"
				data-testid="move-lesson-dialog"
				data-state={state}
				onClick={(e) => e.stopPropagation()}
				className="lh-dialog flex w-[28rem] max-w-[calc(100vw-2rem)] flex-col gap-3 border bg-card p-5 text-xs shadow-xl"
			>
				<h2 className="text-sm font-semibold text-foreground">Move lesson to another class</h2>
				<code className="font-mono text-sm text-foreground">{lesson.title}</code>
				<div className="flex flex-col gap-0.5">
					{options.map((o) => (
						<label key={o.id ?? "none"} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-accent">
							<input type="radio" name="move-target" checked={target === o.id} onChange={() => setTarget(o.id)} className="accent-primary" />
							<span className="font-prose text-sm">{o.name}</span>
							{o.id === from && <span className="text-muted-foreground">(current)</span>}
						</label>
					))}
				</div>
				<p className="text-muted-foreground">
					Its facts leave the current class&apos;s graph (facts another lesson or file also taught stay) and are rebuilt in the new
					class&apos;s graph. Rebuilding uses your background model.
				</p>
				{error && <div className=" border border-destructive/50 px-3 py-2 text-destructive">{error}</div>}
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onClose} className="lh-press px-3 py-1.5 hover:bg-accent">
						Cancel
					</button>
					<button
						type="button"
						data-testid="move-lesson-confirm"
						disabled={busy || target === from}
						onClick={() => void move()}
						className="lh-press bg-primary px-3 py-1.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						Move
					</button>
				</div>
			</div>
		</div>
	);
}
