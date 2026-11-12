import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { SpaceDeadline, SpaceFile } from "@/shared/core";
import {
	addBody,
	draftChanged,
	draftFrom,
	draftProblem,
	FILE_FILTER_FROM,
	fileDayLabel,
	filterFiles,
	KIND_OPTIONS,
	NEW_DEADLINE,
	toggleFile,
	updateBody,
	type DeadlineDraft,
} from "@/frontend/components/space-deadlines-model";
import { jsonInit, send } from "@/frontend/components/files/space-files-api";
import { CheckRow } from "@/frontend/components/ui/check-row";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { FIELD } from "@/frontend/components/ui/field";
import { FootQuestion } from "@/frontend/components/ui/foot-question";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { Segmented } from "@/frontend/components/ui/segmented";

/** What the dialog opens on. One object per open: the dialog compares it by identity. */
interface DeadlineDialogMode {
	spaceId: string;
	/** The deadline to edit; null adds one. */
	deadline: SpaceDeadline | null;
	/** Every space file, in space order. */
	files: readonly SpaceFile[];
}

/**
 * "Add a deadline" and "Edit deadline": its kind, name, date, time and the
 * files it covers; an existing one also has Done and "Remove deadline".
 * Nothing is saved until Save. Closing with changes asks first.
 */
export function DeadlineDialog({ mode, onClose, onRemoved }: { mode: DeadlineDialogMode | null; onClose: () => void; onRemoved?: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(mode);
	if (!mounted || !shown) return null;
	return createPortal(<DeadlineDialogInner mode={shown} state={state} onClose={onClose} onRemoved={onRemoved ?? onClose} />, document.body);
}

const KINDS = KIND_OPTIONS.map((o) => ({ value: o.kind, label: o.label }));

const isGone = (body: unknown) => (body as { code?: string } | null)?.code === "deadline_not_found";

function DeadlineDialogInner({ mode, state, onClose, onRemoved }: { mode: DeadlineDialogMode; state: "open" | "closed"; onClose: () => void; onRemoved: () => void }) {
	// The deadline as it was when the dialog opened: Save sends what differs from it.
	const [saved] = useState(mode.deadline);
	const [draft, setDraft] = useState<DeadlineDraft>(() => (saved ? draftFrom(saved) : NEW_DEADLINE));
	const [filter, setFilter] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [asking, setAsking] = useState<"discard" | "remove" | null>(null);
	const change = (patch: Partial<DeadlineDraft>) => setDraft((d) => ({ ...d, ...patch }));

	const order = useMemo(() => mode.files.map((f) => f.id), [mode.files]);
	// The space's study files, plus any other file the deadline already lists.
	const shown = mode.files.filter((f) => f.kind === "study" || draft.fileIds.includes(f.id));
	const listed = filterFiles(shown, filter);

	const unsaved = draftChanged(saved, draft);
	/** "Close", Esc and a click outside: ask first when something would be
	 *  lost. Esc on a question goes back to editing. */
	const requestClose = useCallback(() => {
		if (busy) return;
		if (asking) setAsking(null);
		else if (unsaved) setAsking("discard");
		else onClose();
	}, [busy, asking, unsaved, onClose]);

	const base = `/api/spaces/${encodeURIComponent(mode.spaceId)}/deadlines`;
	const save = async () => {
		const problem = draftProblem(draft);
		if (problem) return setError(problem);
		if (saved && !unsaved) return onClose();
		setBusy(true);
		setError(null);
		const { error: failed, body } = saved
			? await send(`${base}/${encodeURIComponent(saved.id)}`, jsonInit("PUT", updateBody(saved, draft)))
			: await send(base, jsonInit("POST", addBody(draft)));
		setBusy(false);
		if (failed) return setError(saved && isGone(body) ? `${saved.name} was removed while you were editing it, so your changes weren't saved.` : failed);
		onClose();
	};
	const remove = async () => {
		if (!saved) return;
		setBusy(true);
		setError(null);
		const { error: failed, body } = await send(`${base}/${encodeURIComponent(saved.id)}`, { method: "DELETE" });
		setBusy(false);
		// Already removed (by an agent) is what was asked for.
		if (failed && !isGone(body)) {
			setAsking(null);
			return setError(failed);
		}
		onRemoved();
	};

	const foot =
		asking === "discard" ? (
			<FootQuestion testid="deadline-discard" line="Discard your changes?" keep="Keep editing" go="Discard" quiet busy={busy} onKeep={() => setAsking(null)} onGo={onClose} />
		) : asking === "remove" && saved ? (
			<FootQuestion testid="deadline-remove-confirm" line={`Remove ${saved.name}? This can't be undone.`} keep="Cancel" go="Remove deadline" busy={busy} onKeep={() => setAsking(null)} onGo={() => void remove()} />
		) : (
			<>
				{saved && (
					<button type="button" data-testid="deadline-remove" disabled={busy} onClick={() => setAsking("remove")} className="lh-btn lh-btn-quiet -ml-1.5 text-[15px] text-ans-wrong hover:text-ans-wrong-hover">
						Remove deadline
					</button>
				)}
				<span className="flex-1" />
				<button type="button" data-testid="deadline-save" disabled={busy} onClick={() => void save()} className="lh-btn lh-btn-main h-[38px] px-[22px] text-[15px]">
					{saved ? "Save" : "Add deadline"}
				</button>
			</>
		);

	return (
		<DialogSheet title={saved ? "Edit deadline" : "Add a deadline"} state={state} testid="deadline-dialog" busy={busy} onClose={requestClose} foot={foot}>
			<div className="flex flex-col gap-1.5">
				<span className={LABEL_TEXT}>Kind</span>
				<Segmented label="Kind" testid="deadline-kind" options={KINDS} value={draft.kind} disabled={busy} onChange={(kind) => change({ kind })} />
			</div>
			<label className="flex flex-col gap-1.5">
				<span className={LABEL_TEXT}>Name</span>
				<input
					type="text"
					data-testid="deadline-name"
					value={draft.name}
					disabled={busy}
					placeholder="Homework 5"
					onChange={(e) => change({ name: e.target.value })}
					className={FIELD}
					data-autofocus={saved ? undefined : true}
				/>
			</label>
			<div className="flex items-end gap-3">
				<label className="flex min-w-0 flex-1 flex-col gap-1.5">
					<span className={LABEL_TEXT}>Date</span>
					<input type="date" data-testid="deadline-date" value={draft.date} disabled={busy} onChange={(e) => change({ date: e.target.value })} className={FIELD} />
				</label>
				<label className="flex min-w-0 flex-1 flex-col gap-1.5">
					<span className={LABEL_TEXT}>Time (optional)</span>
					<input type="time" data-testid="deadline-time" value={draft.time} disabled={busy} onChange={(e) => change({ time: e.target.value })} className={FIELD} />
				</label>
				{draft.time !== "" && (
					<button type="button" data-testid="deadline-time-clear" disabled={busy} onClick={() => change({ time: "" })} className="lh-btn lh-btn-quiet h-10 shrink-0 text-[15px]">
						Clear time
					</button>
				)}
			</div>
			{shown.length > 0 && (
				<div className="flex flex-col gap-1.5">
					<span className={LABEL_TEXT}>Files this covers</span>
					{shown.length >= FILE_FILTER_FROM && (
						<input
							type="text"
							data-testid="deadline-file-filter"
							aria-label="Filter files"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							placeholder="Filter"
							spellCheck={false}
							className={FIELD}
						/>
					)}
					{/* Its own scroll, so Done and Save stay in sight under a long list. */}
					<div role="group" aria-label="Files this covers" className="flex max-h-[212px] flex-col overflow-y-auto rounded border border-border bg-background px-3 py-1.5">
						{listed.map((f) => (
							<CheckRow key={f.id} testid={`deadline-file-${f.id}`} label={f.name} note={fileDayLabel(f.name)} checked={draft.fileIds.includes(f.id)} disabled={busy} onToggle={() => change({ fileIds: toggleFile(draft.fileIds, f.id, order) })} />
						))}
						{listed.length === 0 && <p className="py-1.5 text-[15px] text-ink-2">No file matches.</p>}
					</div>
				</div>
			)}
			{saved && <CheckRow testid="deadline-done" label="Done" checked={draft.done} disabled={busy} onToggle={() => change({ done: !draft.done })} />}
			{error && (
				<p key={error} ref={(el) => el?.scrollIntoView({ block: "nearest" })} role="alert" data-testid="deadline-dialog-error" className="text-[15px] whitespace-pre-wrap text-ans-wrong">
					{error}
				</p>
			)}
		</DialogSheet>
	);
}
