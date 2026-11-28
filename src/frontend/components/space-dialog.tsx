/**
 * "Add a space" (name and description) and "Edit space": name,
 * description, icon, color, signature and its rules for the teacher, with
 * Close space and Delete space in the foot. Its files live on the Files tab
 * and its deadlines on the Deadlines tab.
 *
 * Every write goes to /api/spaces/*; the server announces spaces-changed
 * and the space list refetches. Closing with unsaved changes asks "Discard
 * your changes?" first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { LoadingBox, useWaited } from "@/frontend/components/loading";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { useCloseSpace } from "@/frontend/components/top-bar/use-close-space";
import { RuleChips } from "@/frontend/components/rule-chips";
import { changedFields } from "@/frontend/components/space-deadlines-model";
import { useSpaceRecord } from "@/frontend/components/files/space-record";
import { jsonInit, send } from "@/frontend/lib/api";
import { DEFAULT_TEACHER_NAME, savedTimes, type SpaceColor, type SpaceIcon, type SpaceRecord, type SpaceSignature, type SignatureKind } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { useSavedRules } from "@/frontend/components/use-saved-rules";
import { SpaceSignatureField } from "@/frontend/components/space-signature-field";
import { SpaceIconField } from "@/frontend/components/space-icon-field";
import { SpaceColorField } from "@/frontend/components/space-color-field";
import { forgetLessonDraft } from "@/frontend/components/lesson/use-lesson-drafts";
import { LoadFailed } from "@/frontend/components/load-failed";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { FIELD } from "@/frontend/components/ui/field";
import { FootQuestion } from "@/frontend/components/ui/foot-question";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { ErrorLine } from "@/frontend/components/error-line";
import { cn } from "@/frontend/lib/utils";

export type SpaceDialogMode = { kind: "create" } | { kind: "edit"; spaceId: string };

export function SpaceDialog({ mode, onClose }: { mode: SpaceDialogMode | null; onClose: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(mode);
	if (!mounted || !shown) return null;
	return createPortal(<SpaceDialogInner mode={shown} onClose={onClose} state={state} />, document.body);
}

/** The space's own fields as the Edit space dialog sends them. */
type SpaceFields = { name: string; description: string; signature: SpaceSignature | null; icon?: SpaceIcon; color: SpaceColor; rules: string[] };

function scrollIntoSight(el: HTMLElement | null) {
	el?.scrollIntoView({ block: "nearest" });
}

function SpaceDialogInner({ mode, onClose, state }: { mode: SpaceDialogMode; onClose: () => void; state: "open" | "closed" }) {
	const { active, setActive } = useSpaces();
	const navigate = useNavigate();
	const spaceId = mode.kind === "create" ? null : mode.spaceId;
	/** The space while it is being deleted: nothing reads it again meanwhile. */
	const [leaving, setLeaving] = useState<SpaceRecord | null>(null);
	const { record: read, failed: recordFailed, reload } = useSpaceRecord(leaving ? null : spaceId);
	const record = leaving ?? read;
	// Edit space with nothing to edit: say so instead of showing empty fields.
	const loadFailed = mode.kind === "edit" && !record && recordFailed;
	// Edit space waits for the space before showing its fields.
	const loading = mode.kind === "edit" && !record && !recordFailed;
	// The fields step in when they replace the wait for the space.
	const waited = useWaited(!loading);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [signature, setSignature] = useState<{ kind: SignatureKind; value: string }>({ kind: "math", value: "" });
	const [icon, setIcon] = useState<SpaceIcon | undefined>(undefined);
	const [color, setColor] = useState<SpaceColor>(1);
	const [rules, setRules] = useState<string[]>([]);
	const savedRules = useSavedRules(record?.rules);
	const teacherName = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const closer = useCloseSpace();
	const busy = saving || closer.busy;
	const [asking, setAsking] = useState<"discard" | "delete" | null>(null);

	// First load fills the fields; later refreshes keep your edits. Save
	// writes only what changed since this first load (the seeded copy).
	const seeded = useRef<SpaceFields | null>(null);
	useEffect(() => {
		if (record && !seeded.current) {
			seeded.current = { name: record.name, description: record.description, signature: record.signature ?? null, icon: record.icon, color: record.color, rules: record.rules ?? [] };
			setName(record.name);
			setDescription(record.description);
			if (record.signature) setSignature(record.signature);
			setIcon(record.icon);
			setColor(record.color);
			setRules(record.rules ?? []);
		}
	}, [record]);

	const fields: SpaceFields = { name, description, signature: signature.value.trim() ? signature : null, icon, color, rules };
	const unsaved =
		mode.kind === "create"
			? name.trim() !== "" || description.trim() !== ""
			: !!seeded.current && Object.keys(changedFields(seeded.current, fields)).length > 0;
	/** "Close", Esc and a click outside: ask first when something would be
	 *  lost. On a question they go back to editing. A save in flight stays
	 *  open so its error can show. */
	const requestClose = useCallback(() => {
		if (busy) return;
		if (asking) setAsking(null);
		else if (unsaved) setAsking("discard");
		else onClose();
	}, [busy, asking, unsaved, onClose]);

	const call = async (url: string, init: RequestInit): Promise<unknown | null> => {
		setSaving(true);
		setError(null);
		const { error: failed, body } = await send(url, init);
		setSaving(false);
		if (failed) {
			setError(failed);
			return null;
		}
		return body;
	};

	const named = () => {
		if (name.trim() !== "") return true;
		setError("A space needs a name.");
		return false;
	};

	/** Writes what changed in Edit space; false when there is nothing to write to or the write failed. */
	const saveEdits = async (): Promise<boolean> => {
		const seed = seeded.current;
		if (!record || !seed) return false;
		const body = changedFields(seed, fields);
		return Object.keys(body).length === 0 || !!(await call(`/api/spaces/${encodeURIComponent(record.id)}`, jsonInit("PUT", body)));
	};

	const save = async () => {
		if (!named()) return;
		if (mode.kind === "create") {
			const body = (await call("/api/spaces", jsonInit("POST", { name, description }))) as { space?: SpaceRecord } | null;
			if (body?.space) {
				setActive(body.space.id);
				onClose();
			}
			return;
		}
		if (await saveEdits()) onClose();
	};

	/** Leaves the space on screen before deleting it, so no page asks for it
	 *  once it is gone, then goes to Home. Deleting another space keeps the
	 *  page. A refused delete comes back to it. */
	const remove = async (space: SpaceRecord) => {
		const wasActive = space.id === active;
		setLeaving(space);
		if (wasActive) setActive(null);
		const body = (await call(`/api/spaces/${space.id}`, { method: "DELETE" })) as { lessonIds: string[] } | null;
		if (!body) {
			setLeaving(null);
			if (wasActive) setActive(space.id);
			setAsking(null);
			return;
		}
		for (const id of body.lessonIds) forgetLessonDraft(id);
		if (wasActive) navigate("/");
		onClose();
	};

	/** Edits typed here are saved first, so closing the space loses nothing. The dialog is only
	 *  opened from the space on screen, so closing that space goes to Home. */
	const closeSpace = async (space: SpaceRecord) => {
		if (named() && (await saveEdits()) && (await closer.close(space, true))) onClose();
	};

	const shownError = error ?? closer.error;
	// Scrolled to on each new error, so it is never out of sight after Save.
	const errorLine = <ErrorLine error={shownError} ref={scrollIntoSight} data-testid="space-dialog-error" className="text-ui whitespace-pre-wrap text-ans-wrong" />;

	if (asking === "delete" && record) {
		return (
			<DialogSheet
				title={`Delete ${record.name}?`}
				state={state}
				testid="space-dialog"
				busy={busy}
				onClose={requestClose}
				foot={
					<>
						<span className="flex-1" />
						<button type="button" data-testid="space-delete-cancel" disabled={busy} onClick={() => setAsking(null)} className="lh-btn">
							Cancel
						</button>
						<button type="button" data-testid="space-delete-confirm-button" disabled={busy} onClick={() => void remove(record)} className="lh-btn lh-btn-danger">
							Delete space
						</button>
					</>
				}
			>
				<p data-testid="space-delete-confirm" className="text-item text-ink">
					This permanently removes the space, all its lessons, its copied files, and its knowledge graph. A linked folder on your computer is not touched. This cannot be undone.
				</p>
				{errorLine}
			</DialogSheet>
		);
	}

	const editing = mode.kind === "edit" && record;
	return (
		<DialogSheet
			title={mode.kind === "create" ? "Add a space" : "Edit space"}
			state={state}
			testid="space-dialog"
			busy={busy}
			onClose={requestClose}
			foot={
				asking === "discard" ? (
					<FootQuestion
						testid="space-discard"
						line="Discard your changes?"
						note={mode.kind === "create" ? "What you typed here hasn't been saved." : "What you changed here hasn't been saved."}
						keep="Keep editing"
						go="Discard"
						quiet
						busy={busy}
						onKeep={() => setAsking(null)}
						onGo={onClose}
					/>
				) : (
					<>
						{editing && (
							<>
								<button type="button" data-testid="space-close" disabled={busy} onClick={() => void closeSpace(editing)} className="lh-btn lh-btn-quiet">
									Close space
								</button>
								<button type="button" data-testid="space-delete" disabled={busy} onClick={() => setAsking("delete")} className="lh-btn lh-btn-quiet text-ans-wrong hover:text-ans-wrong-hover">
									Delete space
								</button>
							</>
						)}
						<span className="flex-1" />
						<button type="button" data-testid="space-save" disabled={busy || loadFailed || loading} onClick={() => void save()} className="lh-btn lh-btn-main">
							{mode.kind === "create" ? "Add space" : "Save"}
						</button>
					</>
				)
			}
		>
			{loadFailed ? (
				<LoadFailed message="Couldn't load this space." onRetry={() => void reload()} />
			) : loading ? (
				// As tall as the fields, so the dialog doesn't jump when the space arrives.
				<LoadingBox data-testid="space-dialog-loading" className="min-h-[420px]" />
			) : (
				<div className={cn("contents", waited && "lh-set")}>
					<label className="flex flex-col gap-1.5">
						<span className={LABEL_TEXT}>Name</span>
						<input
							type="text"
							data-testid="space-name"
							value={name}
							disabled={busy}
							onChange={(e) => setName(e.target.value)}
							placeholder="For example MATH 20C, Calculus III"
							className={FIELD}
							data-autofocus
						/>
					</label>
					<label className="flex flex-col gap-1.5">
						<span className={LABEL_TEXT}>Description</span>
						<textarea
							data-testid="space-description"
							value={description}
							disabled={busy}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Your level, the book or source you follow, what you are working toward (a course's exams, a job interview). The teacher reads this."
							className={`${FIELD} h-auto min-h-[84px] resize-y py-[9px] leading-ui`}
						/>
					</label>
					{editing && (
						<>
							<SpaceIconField icon={icon} disabled={busy} onChange={setIcon} />
							<SpaceColorField color={color} disabled={busy} onChange={setColor} />
							<SpaceSignatureField kind={signature.kind} value={signature.value} disabled={busy} onChange={(kind, value) => setSignature({ kind, value })} />
							<div className="flex flex-col gap-1.5">
								<span className={LABEL_TEXT}>Rules for this space</span>
								<span className="text-ui text-ink-2">Added to your rules in every {editing.name} lesson</span>
								<RuleChips rules={rules} onChange={setRules} testid="space-rules" saved={savedTimes(savedRules, { spaceId: editing.id })} teacherName={teacherName} />
							</div>
						</>
					)}
				</div>
			)}
			{errorLine}
		</DialogSheet>
	);
}
