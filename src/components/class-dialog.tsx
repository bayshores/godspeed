/**
 * THE CLASS DIALOG: create a
 * class (name and description) or edit one — name, description, signature,
 * its rules for the teacher and its Deadlines — with Archive and Delete class in the footer. The class's files live on the Files page (src/components/files/*).
 *
 * Deadline edits are drafts until Save (src/components/class-deadlines-model.ts
 * turns them into the deadline routes' writes). Every write goes to /api/classes/*;
 * the server announces classes-changed and the class list refetches. Closing
 * with unsaved changes (backdrop, Esc or X) asks "Discard your changes?" first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import { useClasses } from "@/components/class-context";
import { DeadlinesEditor } from "@/components/class-deadlines";
import { RuleChips } from "@/components/rule-chips";
import { changedFields, deadlineWrites, draftProblem, draftsFrom, dropRemoved, hasUnsavedChanges, type DeadlineDraft } from "@/components/class-deadlines-model";
import { jsonInit, send, useClassRecord } from "@/components/files/class-files-api";
import type { ClassDeadline, ClassIcon, ClassRecord, ClassSignature, SignatureKind } from "@/core";
import { ClassSignatureField } from "@/components/class-signature-field";
import { ClassIconField } from "@/components/class-icon-field";
import { forgetLessonDraft } from "@/components/lesson/use-lesson-drafts";

/** `newDeadline`: open with a new deadline row ready to fill (Home's Add deadline). */
export type ClassDialogMode = { kind: "create" } | { kind: "edit"; classId: string; newDeadline?: boolean };
type Mode = ClassDialogMode;

/** Exit motion: the dialog stays mounted
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

/** The class's own fields as the Edit class dialog sends them. */
type ClassFields = { name: string; description: string; signature: ClassSignature | null; icon?: ClassIcon; rules: string[] };

const LABEL = "text-[13px] font-bold text-ink-2";
const FIELD =
	"w-full bg-background px-3 py-2.5 text-[14.5px] leading-[21px] text-ink border border-tone-2 placeholder:text-ink-3 focus:border-ink-3";

function ClassDialogInner({ mode, onClose, state }: { mode: Mode; onClose: () => void; state: MotionState }) {
	const { active, setActive } = useClasses();
	const classId = mode.kind === "edit" ? mode.classId : null;
	const { record, reload } = useClassRecord(classId);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [signature, setSignature] = useState<{ kind: SignatureKind; value: string }>({ kind: "math", value: "" });
	const [icon, setIcon] = useState<ClassIcon | undefined>(undefined);
	const [rules, setRules] = useState<string[]>([]);
	const [drafts, setDrafts] = useState<DeadlineDraft[]>([]);
	const [openDeadline, setOpenDeadline] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const newCount = useRef(0);

	// First load fills the fields; later refreshes keep your edits. Save
	// writes only what changed since this first load (the seeded copy).
	const seeded = useRef<{ fields: ClassFields; deadlines: ClassDeadline[] } | null>(null);
	useEffect(() => {
		if (record && !seeded.current) {
			seeded.current = {
				fields: { name: record.name, description: record.description, signature: record.signature ?? null, icon: record.icon, rules: record.rules ?? [] },
				deadlines: record.deadlines ?? [],
			};
			setName(record.name);
			setDescription(record.description);
			if (record.signature) setSignature(record.signature);
			setIcon(record.icon);
			setRules(record.rules ?? []);
			const drafts = draftsFrom(record.deadlines);
			if (mode.kind === "edit" && mode.newDeadline) {
				const key = `new-${++newCount.current}`;
				drafts.push({ key, kind: "homework", name: "", date: "", time: "", fileIds: [], done: false });
				setOpenDeadline(key);
			}
			setDrafts(drafts);
		}
	}, [record, mode]);

	// A deadline an agent removes while the dialog is open leaves it too,
	// unless the learner edited it (then Save says it is gone).
	const seenLive = useRef(new Set<string>());
	useEffect(() => {
		const seed = seeded.current;
		if (!record || !seed) return;
		const live = new Set((record.deadlines ?? []).map((d) => d.id));
		for (const id of live) seenLive.current.add(id);
		const next = dropRemoved(seed.deadlines, drafts, new Set([...seenLive.current].filter((id) => !live.has(id))));
		if (!next) return;
		seed.deadlines = next.seeded;
		setDrafts(next.drafts);
	}, [record, drafts]);

	const fields: ClassFields = { name, description, signature: signature.value.trim() ? signature : null, icon, rules };
	const unsaved =
		mode.kind === "create"
			? name.trim() !== "" || description.trim() !== ""
			: !!seeded.current && hasUnsavedChanges(seeded.current, fields, drafts);
	/** Backdrop, Esc and X: ask first when something would be lost. A save
	 *  in flight stays open so its error can show. */
	const requestClose = useCallback(() => {
		if (busy) return;
		if (unsaved) {
			setConfirmDelete(false);
			setConfirmDiscard(true);
		} else onClose();
	}, [busy, unsaved, onClose]);

	const backdropDismiss = useBackdropDismiss(() => {
		if (!confirmDiscard) requestClose();
	});
	useEffect(() => {
		if (state === "closed") return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Claimed even while saving, so Esc never reaches the abort-turn fallback.
				e.preventDefault();
				e.stopPropagation();
				// Esc on the discard question keeps editing.
				if (confirmDiscard) setConfirmDiscard(false);
				else requestClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [confirmDiscard, requestClose, state]);

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
		setDrafts((ds) => [...ds, { key, kind: "homework", name: "", date: "", time: "", fileIds: [], done: false }]);
		setOpenDeadline(key);
	}, []);
	const removeDeadline = useCallback((key: string) => {
		setDrafts((ds) => ds.filter((d) => d.key !== key));
	}, []);

	/** Save the deadline drafts: each write in turn, and each one that lands
	 *  updates the seeded copy, so a retried Save sends only what is left.
	 *  An edited deadline that was removed while the dialog was open is
	 *  dropped and named in the returned message; it is never added back. */
	const saveDeadlines = async (classId: string, seed: { deadlines: ClassDeadline[] }): Promise<string | null> => {
		const base = `/api/classes/${encodeURIComponent(classId)}/deadlines`;
		const settle = (id: string, deadline?: ClassDeadline) => {
			seed.deadlines = seed.deadlines.flatMap((d) => (d.id !== id ? [d] : deadline ? [deadline] : []));
		};
		const gone = (body: unknown) => (body as { code?: string } | null)?.code === "deadline_not_found";
		const removed: string[] = [];
		for (const w of deadlineWrites(seed.deadlines, drafts)) {
			if (w.op === "remove") {
				const { error: failed, body } = await send(`${base}/${encodeURIComponent(w.id)}`, { method: "DELETE" });
				// Already removed (by an agent) is what the learner asked for.
				if (failed && !gone(body)) return failed;
				settle(w.id);
			} else if (w.op === "update") {
				const { error: failed, body } = await send(`${base}/${encodeURIComponent(w.id)}`, jsonInit("PUT", w.body));
				if (failed && !gone(body)) return failed;
				if (failed) {
					settle(w.id);
					removed.push(drafts.find((d) => d.key === w.key)?.name.trim() || "A deadline");
					setDrafts((ds) => ds.filter((d) => d.key !== w.key));
					continue;
				}
				settle(w.id, (body as { deadline?: ClassDeadline } | null)?.deadline);
			} else {
				const { error: failed, body } = await send(base, jsonInit("POST", w.body));
				if (failed) return failed;
				const deadline = (body as { deadline?: ClassDeadline } | null)?.deadline;
				if (!deadline) continue;
				// A retried Save sees the new id; a ticked one then PUTs done.
				seed.deadlines = [...seed.deadlines, deadline];
				setDrafts((ds) => ds.map((d) => (d.key === w.key ? { ...d, id: deadline.id } : d)));
				if (w.done) {
					const { error: doneFailed, body: doneBody } = await send(`${base}/${encodeURIComponent(deadline.id)}`, jsonInit("PUT", { done: true }));
					if (doneFailed) return doneFailed;
					settle(deadline.id, (doneBody as { deadline?: ClassDeadline } | null)?.deadline);
				}
			}
		}
		if (removed.length === 0) return null;
		return removed.length === 1
			? `${removed[0]} was removed while you were editing it, so your changes to it weren't saved.`
			: `${removed.join(", ")} were removed while you were editing them, so your changes to them weren't saved.`;
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
		const seed = seeded.current;
		if (!record || !seed) return;
		const problem = draftProblem(drafts);
		if (problem) {
			setError(problem);
			return;
		}
		setBusy(true);
		setError(null);
		const body = changedFields(seed.fields, fields);
		let failed: string | null = null;
		if (Object.keys(body).length > 0) {
			failed = (await send(`/api/classes/${encodeURIComponent(record.id)}`, jsonInit("PUT", body))).error;
			if (!failed) seed.fields = fields;
		}
		const deadlinesFailed = failed ?? (await saveDeadlines(record.id, seed));
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
					<button
						type="button"
						aria-label="Close"
						data-testid="class-dialog-close"
						disabled={busy}
						onClick={requestClose}
						className="lh-press text-ink-2 hover:text-ink disabled:opacity-60"
					>
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

					{mode.kind === "edit" && record && <ClassIconField icon={icon} disabled={busy} labelClass={LABEL} onChange={setIcon} />}

					{mode.kind === "edit" && record && (
						<ClassSignatureField
							kind={signature.kind}
							value={signature.value}
							disabled={busy}
							labelClass={LABEL}
							fieldClass={FIELD}
							onChange={(kind, value) => setSignature({ kind, value })}
						/>
					)}

					{mode.kind === "edit" && record && (
						<div className="mt-2.5 flex flex-col gap-2">
							<span className="flex items-baseline justify-between gap-3">
								<span className={LABEL}>Rules for this class</span>
								<span className="text-xs text-ink-2">Added to your rules in every {record.name} lesson</span>
							</span>
							<RuleChips rules={rules} onChange={setRules} testid="class-rules" />
						</div>
					)}

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

				{confirmDiscard ? (
					<div data-testid="class-discard-confirm" className="flex shrink-0 flex-col gap-2 border-t border-tone-2 px-5 py-3.5 text-[13px]">
						<span className="text-sm font-bold text-ans-wrong">Discard your changes?</span>
						<span className="text-ink-2">What you changed here hasn&apos;t been saved.</span>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								data-testid="class-discard-cancel"
								onClick={() => setConfirmDiscard(false)}
								className="lh-press px-3 py-1.5 font-bold text-ink-2 hover:text-ink"
							>
								Keep editing
							</button>
							<button
								type="button"
								data-testid="class-discard-confirm-button"
								onClick={onClose}
								className="lh-press bg-ans-wrong px-3 py-1.5 font-bold text-white hover:bg-red-600"
							>
								Discard
							</button>
						</div>
					</div>
				) : confirmDelete && record ? (
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
									void call(`/api/classes/${record.id}`, { method: "DELETE" }).then((body) => {
										if (body) {
											for (const id of (body as { lessonIds: string[] }).lessonIds) forgetLessonDraft(id);
											if (record.id === active) setActive(null);
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
													if (record.id === active) setActive(null);
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
							className="lh-press bg-ink px-4 py-[9px] text-sm font-extrabold text-background hover:bg-ink-max disabled:opacity-60"
						>
							{mode.kind === "create" ? "Create class" : "Save"}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

/** "Move to class…": the lesson's facts leave the old class graph and
 *  are rebuilt in the new one. */
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
	useEffect(() => {
		if (state === "closed") return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				if (!busy) onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [busy, onClose, state]);
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
					class&apos;s graph. Rebuilding is done by your agent.
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
