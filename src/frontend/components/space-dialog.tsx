/**
 * "Add a space" (name and description) and "Edit space": name,
 * description, icon, color, signature and its rules for the teacher, with
 * Archive and Delete space in the foot. Its files live on the Files tab and
 * its deadlines on the Deadlines tab.
 *
 * Every write goes to /api/spaces/*; the server announces spaces-changed
 * and the space list refetches. Closing with unsaved changes asks "Discard
 * your changes?" first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSpaces } from "@/frontend/components/space-context";
import { RuleChips } from "@/frontend/components/rule-chips";
import { changedFields } from "@/frontend/components/space-deadlines-model";
import { jsonInit, send, useSpaceRecord } from "@/frontend/components/files/space-files-api";
import { DEFAULT_TEACHER_NAME, savedTimes, type SpaceColor, type SpaceIcon, type SpaceRecord, type SpaceSignature, type SignatureKind } from "@/shared/core";
import { useHalley } from "@/frontend/components/halley/halley-provider";
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

type Mode = { kind: "create" } | { kind: "edit"; spaceId: string };

export function SpaceDialog({ mode, onClose }: { mode: Mode | null; onClose: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(mode);
	if (!mounted || !shown) return null;
	return createPortal(<SpaceDialogInner mode={shown} onClose={onClose} state={state} />, document.body);
}

/** The space's own fields as the Edit space dialog sends them. */
type SpaceFields = { name: string; description: string; signature: SpaceSignature | null; icon?: SpaceIcon; color: SpaceColor; rules: string[] };

function scrollIntoSight(el: HTMLElement | null) {
	el?.scrollIntoView({ block: "nearest" });
}

function SpaceDialogInner({ mode, onClose, state }: { mode: Mode; onClose: () => void; state: "open" | "closed" }) {
	const { active, setActive } = useSpaces();
	const router = useRouter();
	const spaceId = mode.kind === "edit" ? mode.spaceId : null;
	/** The space while it is being deleted: nothing reads it again meanwhile. */
	const [leaving, setLeaving] = useState<SpaceRecord | null>(null);
	const { record: read, failed: recordFailed, reload } = useSpaceRecord(leaving ? null : spaceId);
	const record = leaving ?? read;
	// Edit space with nothing to edit: say so instead of showing empty fields.
	const loadFailed = mode.kind === "edit" && !record && recordFailed;
	// Edit space waits for the space before showing its fields.
	const loading = mode.kind === "edit" && !record && !recordFailed;
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [signature, setSignature] = useState<{ kind: SignatureKind; value: string }>({ kind: "math", value: "" });
	const [icon, setIcon] = useState<SpaceIcon | undefined>(undefined);
	const [color, setColor] = useState<SpaceColor>(1);
	const [rules, setRules] = useState<string[]>([]);
	const savedRules = useSavedRules(record?.rules);
	const teacherName = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
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

	const save = async () => {
		if (name.trim() === "") {
			setError("A space needs a name.");
			return;
		}
		if (mode.kind === "create") {
			const body = (await call("/api/spaces", jsonInit("POST", { name, description }))) as { space?: SpaceRecord } | null;
			if (body?.space) {
				setActive(body.space.id);
				onClose();
			}
			return;
		}
		const seed = seeded.current;
		if (!record || !seed) return;
		const body = changedFields(seed, fields);
		if (Object.keys(body).length > 0 && !(await call(`/api/spaces/${encodeURIComponent(record.id)}`, jsonInit("PUT", body)))) return;
		onClose();
	};
	/** Leaves the space before deleting it, so no page asks for it once it
	 *  is gone, then goes to Today. A refused delete comes back to it. */
	const remove = async (space: SpaceRecord) => {
		const wasActive = space.id === active;
		setLeaving(space);
		if (wasActive) setActive(null);
		const body = (await call(`/api/spaces/${space.id}`, { method: "DELETE" })) as { lessonIds: string[] } | null;
		if (!body) {
			setLeaving(null);
			if (wasActive) setActive(space.id);
			return setAsking(null);
		}
		for (const id of body.lessonIds) forgetLessonDraft(id);
		router.push("/");
		onClose();
	};
	const archive = async (space: SpaceRecord) => {
		const ok = await call(`/api/spaces/${space.id}`, jsonInit("PUT", { archived: !space.archived }));
		if (ok && !space.archived) {
			if (space.id === active) setActive(null);
			onClose();
		}
	};

	const errorLine = error && (
		// Scrolled to on each new error, so it is never out of sight after Save.
		<p key={error} ref={scrollIntoSight} role="alert" data-testid="space-dialog-error" className="text-[15px] whitespace-pre-wrap text-ans-wrong">
			{error}
		</p>
	);

	// A prep is a space under its own name.
	const noun = record?.prep ? "prep" : "space";
	if (asking === "delete" && record) {
		return (
			<DialogSheet
				title={`Delete ${record.name}?`}
				state={state}
				testid="space-dialog"
				busy={busy}
				onClose={requestClose}
				className="w-[540px]"
				foot={
					<>
						<span className="flex-1" />
						<button type="button" data-testid="space-delete-cancel" disabled={busy} onClick={() => setAsking(null)} className="lh-btn text-[15px]">
							Cancel
						</button>
						<button type="button" data-testid="space-delete-confirm-button" disabled={busy} onClick={() => void remove(record)} className="lh-btn lh-btn-danger text-[15px]">
							Delete {noun}
						</button>
					</>
				}
			>
				<p data-testid="space-delete-confirm" className="text-lg text-ink">
					This permanently removes the {noun}, all its lessons, its copied files, and its knowledge graph. A linked folder on your computer is not touched. This cannot be undone.
				</p>
				{errorLine}
			</DialogSheet>
		);
	}

	const editing = mode.kind === "edit" && record;
	return (
		<DialogSheet
			title={mode.kind === "create" ? "Add a space" : `Edit ${noun}`}
			state={state}
			testid="space-dialog"
			busy={busy}
			onClose={requestClose}
			className={mode.kind === "edit" ? "w-[620px]" : undefined}
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
								<button type="button" data-testid="space-archive" disabled={busy} onClick={() => void archive(editing)} className="lh-btn text-[15px]">
									{editing.archived ? "Unarchive" : "Archive"}
								</button>
								<button type="button" data-testid="space-delete" disabled={busy} onClick={() => setAsking("delete")} className="lh-btn lh-btn-quiet text-[15px] text-ans-wrong hover:text-ans-wrong-hover">
									Delete {noun}
								</button>
							</>
						)}
						<span className="flex-1" />
						<button type="button" data-testid="space-save" disabled={busy || loadFailed || loading} onClick={() => void save()} className="lh-btn lh-btn-main text-[15px]">
							{mode.kind === "create" ? "Add space" : "Save"}
						</button>
					</>
				)
			}
		>
			{loadFailed ? (
				<LoadFailed message={`Couldn't load this ${noun}.`} onRetry={() => void reload()} />
			) : loading ? (
				// As tall as the fields, so the dialog doesn't jump when the space arrives.
				<p data-testid="space-dialog-loading" className="flex min-h-[420px] items-center justify-center text-[15px] text-ink-2">
					Loading…
				</p>
			) : (
				<>
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
							className={`${FIELD} h-auto min-h-[84px] resize-y py-[9px] leading-[1.4]`}
						/>
					</label>
				</>
			)}
			{editing && (
				<>
					<SpaceIconField icon={icon} agentPicks={!editing.prep} disabled={busy} onChange={setIcon} />
					<SpaceColorField color={color} disabled={busy} onChange={setColor} />
					{!editing.prep && <SpaceSignatureField kind={signature.kind} value={signature.value} disabled={busy} onChange={(kind, value) => setSignature({ kind, value })} />}
					<div className="flex flex-col gap-1.5">
						<span className={LABEL_TEXT}>Rules for this {noun}</span>
						<span className="text-base text-ink-2">Added to your rules in every {editing.name} lesson</span>
						<RuleChips rules={rules} onChange={setRules} testid="space-rules" saved={savedTimes(savedRules, { spaceId: editing.id })} teacherName={teacherName} />
					</div>
				</>
			)}
			{errorLine}
		</DialogSheet>
	);
}
