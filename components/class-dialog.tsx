"use client";

/**
 * THE CLASS DIALOG (classes wave, owner-approved 2026-10-26): create a class
 * or manage one — name, description, its files (each "study material" or
 * "course info", with a status badge), "Add files…", "Link folder…" /
 * "Unlink", Archive, Delete. Portaled z-50 like the other dialogs
 * (delete-session-dialog.tsx is the shape template).
 *
 * Every write goes to /api/classes/*; the server announces classes-changed
 * and the class list (components/class-context.tsx) refetches.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import { useClasses } from "@/components/class-context";
import { useServerEvent } from "@/components/server-events";
import type { ClassFile, ClassRecord } from "@/src/core";
import { cn } from "@/lib/utils";

/** Accepted by "Add files…" (mirrors SUPPORTED_CLASS_FILE_EXTENSIONS). */
export const CLASS_FILE_ACCEPT = ".md,.markdown,.txt,.pdf,.vtt,.srt,.mp3,.m4a,.wav,.mp4,.mov";

export const FILE_STATUS_LABEL: Record<ClassFile["status"], string> = {
	pending: "Waiting",
	extracting: "Working…",
	ready: "Ready",
	failed: "Failed",
	"needs-whisper": "Needs whisper",
};

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

function ClassDialogInner({ mode, onClose, state }: { mode: Mode; onClose: () => void; state: MotionState }) {
	const { setActive } = useClasses();
	const [record, setRecord] = useState<ClassRecord | null>(null);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [folderInput, setFolderInput] = useState("");
	const [addKind, setAddKind] = useState<"study" | "info">("study");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const classId = mode.kind === "edit" ? mode.classId : null;

	const load = useCallback(async () => {
		if (!classId) return;
		const res = await fetch(`/api/classes/${encodeURIComponent(classId)}`, { cache: "no-store" });
		if (!res.ok) return;
		const body = (await res.json()) as { class: ClassRecord };
		setRecord(body.class);
	}, [classId]);

	useEffect(() => {
		void (async () => {
			await load();
		})();
	}, [load]);
	// First load fills the text fields; later refreshes keep your edits.
	const seeded = useRef(false);
	useEffect(() => {
		if (record && !seeded.current) {
			seeded.current = true;
			setName(record.name);
			setDescription(record.description);
			setFolderInput(record.linkedFolder ?? "");
		}
	}, [record]);
	useServerEvent("classes-changed", () => void load());

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
		try {
			const res = await fetch(url, init);
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setError(body.error ?? `Request failed (${res.status})`);
				return null;
			}
			return body;
		} catch {
			setError("Network error. Try again.");
			return null;
		} finally {
			setBusy(false);
		}
	};
	const jsonInit = (method: string, body: unknown): RequestInit => ({
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

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
		const ok = await call(`/api/classes/${classId}`, jsonInit("PUT", { name, description }));
		if (ok) onClose();
	};

	const uploadFiles = async (files: FileList | null) => {
		if (!files || files.length === 0 || !classId) return;
		const form = new FormData();
		form.append("kind", addKind);
		for (const f of Array.from(files)) form.append("files", f);
		const body = (await call(`/api/classes/${classId}/files`, { method: "POST", body: form })) as {
			results?: { name: string; ok: boolean; error?: string }[];
		} | null;
		const failed = body?.results?.filter((r) => !r.ok) ?? [];
		if (failed.length > 0) setError(failed.map((r) => r.error ?? r.name).join("\n"));
		void load();
	};

	const pickFolder = async () => {
		const picked = await window.lh?.pickFolder?.();
		if (picked) setFolderInput(picked);
		return picked ?? null;
	};

	const linkFolder = async (folder: string) => {
		if (!classId || folder.trim() === "") return;
		await call(`/api/classes/${classId}/folder`, jsonInit("PUT", { path: folder.trim() }));
		void load();
	};

	const title = mode.kind === "create" ? "New class" : "Class";
	return (
		<div data-state={state} inert={state === "closed"} className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				data-testid="class-dialog"
				data-state={state}
				onClick={(e) => e.stopPropagation()}
				className="lh-dialog flex max-h-[85vh] w-[36rem] max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto rounded-xl border bg-card p-5 text-xs shadow-xl"
			>
				<h2 className="text-sm font-semibold text-foreground">{title}</h2>

				<label className="flex flex-col gap-1">
					<span className="uppercase tracking-wider text-muted-foreground">Name</span>
					<input
						data-testid="class-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. MATH 20C – Calculus III"
						className="font-prose rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
						autoFocus
					/>
				</label>

				<label className="flex flex-col gap-1">
					<span className="uppercase tracking-wider text-muted-foreground">About the class</span>
					<textarea
						data-testid="class-description"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						rows={4}
						placeholder="Level, textbook, the professor's notation, what exams look like… The teacher reads this."
						className="font-prose resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
					/>
				</label>

				{mode.kind === "edit" && record && (
					<>
						<section className="flex flex-col gap-2" data-testid="class-files">
							<div className="flex items-center justify-between">
								<span className="uppercase tracking-wider text-muted-foreground">Files</span>
								<div className="flex items-center gap-1.5">
									<select
										data-testid="class-add-kind"
										value={addKind}
										onChange={(e) => setAddKind(e.target.value === "info" ? "info" : "study")}
										className="rounded-md border border-border bg-background px-1.5 py-1 text-xs"
										aria-label="Add new files as"
									>
										<option value="study">as study material</option>
										<option value="info">as course info</option>
									</select>
									<input
										ref={fileInputRef}
										type="file"
										multiple
										accept={CLASS_FILE_ACCEPT}
										className="hidden"
										onChange={(e) => {
											void uploadFiles(e.target.files);
											e.target.value = "";
										}}
									/>
									<button
										type="button"
										data-testid="class-add-files"
										disabled={busy}
										onClick={() => fileInputRef.current?.click()}
										className="lh-press rounded-md border border-border px-2 py-1 uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
									>
										Add files…
									</button>
								</div>
							</div>
							<p className="text-muted-foreground/80">
								Study material (notes, readings, transcripts) becomes facts in this class&apos;s graph. Course info (syllabus,
								assignments) is only read by the teacher.
							</p>
							{record.files.length === 0 ? (
								<div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-muted-foreground">No files yet.</div>
							) : (
								<ul className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60">
									{record.files.map((file) => (
										<ClassFileRow key={file.id} classId={record.id} file={file} disabled={busy} onChanged={() => void load()} onError={setError} />
									))}
								</ul>
							)}
						</section>

						<section className="flex flex-col gap-2" data-testid="class-folder">
							<span className="uppercase tracking-wider text-muted-foreground">Linked folder</span>
							<p className="text-muted-foreground/80">
								New files you put in this folder are added as study material automatically, and edited files are rebuilt. The
								folder itself is never changed.
							</p>
							<div className="flex items-center gap-1.5">
								<input
									data-testid="class-folder-path"
									value={folderInput}
									onChange={(e) => setFolderInput(e.target.value)}
									placeholder="/Users/you/School/MATH20C"
									className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
								/>
								{typeof window !== "undefined" && window.lh?.pickFolder && (
									<button
										type="button"
										data-testid="class-pick-folder"
										disabled={busy}
										onClick={() =>
											void pickFolder().then((p) => {
												if (p) void linkFolder(p);
											})
										}
										className="lh-press rounded-md border border-border px-2 py-1 uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
									>
										Choose…
									</button>
								)}
								<button
									type="button"
									data-testid="class-link-folder"
									disabled={busy || folderInput.trim() === "" || folderInput.trim() === record.linkedFolder}
									onClick={() => void linkFolder(folderInput)}
									className="lh-press rounded-md border border-border px-2 py-1 uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
								>
									Link
								</button>
								{record.linkedFolder && (
									<button
										type="button"
										data-testid="class-unlink-folder"
										disabled={busy}
										onClick={() =>
											void call(`/api/classes/${record.id}/folder`, { method: "DELETE" }).then(() => {
												setFolderInput("");
												void load();
											})
										}
										className="lh-press rounded-md border border-border px-2 py-1 uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
									>
										Unlink
									</button>
								)}
							</div>
						</section>
					</>
				)}

				{error && (
					<div data-testid="class-dialog-error" className="whitespace-pre-wrap rounded-md border border-destructive/50 px-3 py-2 text-destructive">
						{error}
					</div>
				)}

				{confirmDelete && record ? (
					<div data-testid="class-delete-confirm" className="flex flex-col gap-2 rounded-md border border-destructive/50 px-3 py-3">
						<span className="text-sm font-semibold text-destructive">Delete {record.name}?</span>
						<span className="text-muted-foreground">
							This permanently removes the class, all its lessons, its copied files, and its knowledge graph. A linked folder on
							your computer is not touched. This cannot be undone.
						</span>
						<div className="flex justify-end gap-2">
							<button type="button" onClick={() => setConfirmDelete(false)} className="lh-press rounded-md px-3 py-1.5 hover:bg-accent">
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
								className="lh-press rounded-md bg-destructive px-3 py-1.5 text-white hover:bg-destructive/90"
							>
								Delete class
							</button>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between gap-2">
						<div className="flex gap-2">
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
										className="lh-press rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
									>
										{record.archived ? "Unarchive" : "Archive"}
									</button>
									<button
										type="button"
										data-testid="class-delete"
										onClick={() => setConfirmDelete(true)}
										className="lh-press rounded-md px-3 py-1.5 text-muted-foreground/80 hover:bg-accent hover:text-destructive"
									>
										Delete…
									</button>
								</>
							)}
						</div>
						<div className="flex gap-2">
							<button type="button" onClick={onClose} className="lh-press rounded-md px-3 py-1.5 hover:bg-accent">
								{mode.kind === "edit" ? "Close" : "Cancel"}
							</button>
							<button
								type="button"
								data-testid="class-save"
								disabled={busy}
								onClick={() => void save()}
								className="lh-press rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:bg-primary/90"
							>
								{mode.kind === "create" ? "Create class" : "Save"}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/** One file row: name, origin, kind toggle, status badge, retry/remove. */
export function ClassFileRow({
	classId,
	file,
	disabled,
	onChanged,
	onError,
}: {
	classId: string;
	file: ClassFile;
	disabled?: boolean;
	onChanged: () => void;
	onError: (message: string | null) => void;
}) {
	const put = async (body: unknown) => {
		const res = await fetch(`/api/classes/${classId}/files/${file.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) onError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Change failed");
		onChanged();
	};
	const remove = async () => {
		const res = await fetch(`/api/classes/${classId}/files/${file.id}`, { method: "DELETE" });
		if (!res.ok) onError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Remove failed");
		onChanged();
	};
	return (
		<li data-testid={`class-file-${file.id}`} className="flex items-center gap-2 px-3 py-2">
			<span className="min-w-0 flex-1 truncate font-prose text-sm text-foreground" title={file.error ?? file.path}>
				{file.name}
				{file.origin === "linked" && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">folder</span>}
			</span>
			<select
				aria-label={`${file.name} kind`}
				value={file.kind}
				disabled={disabled}
				onChange={(e) => void put({ kind: e.target.value })}
				className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]"
			>
				<option value="study">Study material</option>
				<option value="info">Course info</option>
			</select>
			<span
				data-testid={`class-file-status-${file.id}`}
				title={file.error}
				className={cn(
					"w-24 shrink-0 text-right text-[11px] uppercase tracking-wider",
					file.status === "failed" || file.status === "needs-whisper" ? "text-destructive" : "text-muted-foreground",
				)}
			>
				{FILE_STATUS_LABEL[file.status]}
			</span>
			{(file.status === "failed" || file.status === "needs-whisper" || file.status === "pending") && (
				<button type="button" disabled={disabled} onClick={() => void put({ retry: true })} className="lh-press text-muted-foreground hover:text-foreground">
					Retry
				</button>
			)}
			{file.origin === "copied" && (
				<button type="button" disabled={disabled} onClick={() => void remove()} aria-label={`Remove ${file.name}`} className="lh-press text-muted-foreground/70 hover:text-destructive">
					Remove
				</button>
			)}
		</li>
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
				className="lh-dialog flex w-[28rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border bg-card p-5 text-xs shadow-xl"
			>
				<h2 className="text-sm font-semibold text-foreground">Move lesson to another class</h2>
				<code className="font-mono text-sm text-foreground">{lesson.title}</code>
				<div className="flex flex-col gap-0.5">
					{options.map((o) => (
						<label key={o.id ?? "none"} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
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
				{error && <div className="rounded-md border border-destructive/50 px-3 py-2 text-destructive">{error}</div>}
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onClose} className="lh-press rounded-md px-3 py-1.5 hover:bg-accent">
						Cancel
					</button>
					<button
						type="button"
						data-testid="move-lesson-confirm"
						disabled={busy || target === from}
						onClick={() => void move()}
						className="lh-press rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						Move
					</button>
				</div>
			</div>
		</div>
	);
}
