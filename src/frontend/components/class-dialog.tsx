/**
 * "Add a class" (name and description) and "Edit class": name,
 * description, icon, color, signature and its rules for the teacher, with
 * Archive and Delete class in the foot. Its files live on the Files tab and
 * its deadlines on the Deadlines tab.
 *
 * Every write goes to /api/classes/*; the server announces classes-changed
 * and the class list refetches. Closing with unsaved changes asks "Discard
 * your changes?" first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClasses } from "@/frontend/components/class-context";
import { RuleChips } from "@/frontend/components/rule-chips";
import { changedFields } from "@/frontend/components/class-deadlines-model";
import { jsonInit, send, useClassRecord } from "@/frontend/components/files/class-files-api";
import { DEFAULT_TEACHER_NAME, savedTimes, type ClassColor, type ClassIcon, type ClassRecord, type ClassSignature, type SignatureKind } from "@/shared/core";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { useSavedRules } from "@/frontend/components/use-saved-rules";
import { ClassSignatureField } from "@/frontend/components/class-signature-field";
import { ClassIconField } from "@/frontend/components/class-icon-field";
import { ClassColorField } from "@/frontend/components/class-color-field";
import { forgetLessonDraft } from "@/frontend/components/lesson/use-lesson-drafts";
import { LoadFailed } from "@/frontend/components/load-failed";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { FIELD } from "@/frontend/components/ui/field";
import { FootQuestion } from "@/frontend/components/ui/foot-question";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

type Mode = { kind: "create" } | { kind: "edit"; classId: string };

export function ClassDialog({ mode, onClose }: { mode: Mode | null; onClose: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(mode);
	if (!mounted || !shown) return null;
	return createPortal(<ClassDialogInner mode={shown} onClose={onClose} state={state} />, document.body);
}

/** The class's own fields as the Edit class dialog sends them. */
type ClassFields = { name: string; description: string; signature: ClassSignature | null; icon?: ClassIcon; color: ClassColor; rules: string[] };

function scrollIntoSight(el: HTMLElement | null) {
	el?.scrollIntoView({ block: "nearest" });
}

function ClassDialogInner({ mode, onClose, state }: { mode: Mode; onClose: () => void; state: "open" | "closed" }) {
	const { active, setActive } = useClasses();
	const classId = mode.kind === "edit" ? mode.classId : null;
	const { record, failed: recordFailed, reload } = useClassRecord(classId);
	// Edit class with nothing to edit: say so instead of showing empty fields.
	const loadFailed = mode.kind === "edit" && !record && recordFailed;
	// Edit class waits for the class before showing its fields.
	const loading = mode.kind === "edit" && !record && !recordFailed;
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [signature, setSignature] = useState<{ kind: SignatureKind; value: string }>({ kind: "math", value: "" });
	const [icon, setIcon] = useState<ClassIcon | undefined>(undefined);
	const [color, setColor] = useState<ClassColor>(1);
	const [rules, setRules] = useState<string[]>([]);
	const savedRules = useSavedRules(record?.rules);
	const teacherName = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [asking, setAsking] = useState<"discard" | "delete" | null>(null);

	// First load fills the fields; later refreshes keep your edits. Save
	// writes only what changed since this first load (the seeded copy).
	const seeded = useRef<ClassFields | null>(null);
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

	const fields: ClassFields = { name, description, signature: signature.value.trim() ? signature : null, icon, color, rules };
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
		const body = changedFields(seed, fields);
		if (Object.keys(body).length > 0 && !(await call(`/api/classes/${encodeURIComponent(record.id)}`, jsonInit("PUT", body)))) return;
		onClose();
	};
	const remove = async (cls: ClassRecord) => {
		const body = (await call(`/api/classes/${cls.id}`, { method: "DELETE" })) as { lessonIds: string[] } | null;
		if (!body) return setAsking(null);
		for (const id of body.lessonIds) forgetLessonDraft(id);
		if (cls.id === active) setActive(null);
		onClose();
	};
	const archive = async (cls: ClassRecord) => {
		const ok = await call(`/api/classes/${cls.id}`, jsonInit("PUT", { archived: !cls.archived }));
		if (ok && !cls.archived) {
			if (cls.id === active) setActive(null);
			onClose();
		}
	};

	const errorLine = error && (
		// Scrolled to on each new error, so it is never out of sight after Save.
		<p key={error} ref={scrollIntoSight} role="alert" data-testid="class-dialog-error" className="text-[15px] whitespace-pre-wrap text-ans-wrong">
			{error}
		</p>
	);

	if (asking === "delete" && record) {
		return (
			<DialogSheet
				title={`Delete ${record.name}?`}
				state={state}
				testid="class-dialog"
				busy={busy}
				onClose={requestClose}
				className="w-[540px]"
				foot={
					<>
						<span className="flex-1" />
						<button type="button" data-testid="class-delete-cancel" disabled={busy} onClick={() => setAsking(null)} className="lh-btn text-[15px]">
							Cancel
						</button>
						<button type="button" data-testid="class-delete-confirm-button" disabled={busy} onClick={() => void remove(record)} className="lh-btn lh-btn-danger text-[15px]">
							Delete class
						</button>
					</>
				}
			>
				<p data-testid="class-delete-confirm" className="text-lg text-ink">
					This permanently removes the class, all its lessons, its copied files, and its knowledge graph. A linked folder on your computer is not touched. This cannot be undone.
				</p>
				{errorLine}
			</DialogSheet>
		);
	}

	const editing = mode.kind === "edit" && record;
	return (
		<DialogSheet
			title={mode.kind === "create" ? "Add a class" : "Edit class"}
			state={state}
			testid="class-dialog"
			busy={busy}
			onClose={requestClose}
			className={mode.kind === "edit" ? "w-[620px]" : undefined}
			foot={
				asking === "discard" ? (
					<FootQuestion
						testid="class-discard"
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
								<button type="button" data-testid="class-archive" disabled={busy} onClick={() => void archive(editing)} className="lh-btn text-[15px]">
									{editing.archived ? "Unarchive" : "Archive"}
								</button>
								<button type="button" data-testid="class-delete" disabled={busy} onClick={() => setAsking("delete")} className="lh-btn lh-btn-quiet text-[15px] text-ans-wrong hover:text-ans-wrong-hover">
									Delete class
								</button>
							</>
						)}
						<span className="flex-1" />
						<button type="button" data-testid="class-save" disabled={busy || loadFailed || loading} onClick={() => void save()} className="lh-btn lh-btn-main text-[15px]">
							{mode.kind === "create" ? "Add class" : "Save"}
						</button>
					</>
				)
			}
		>
			{loadFailed ? (
				<LoadFailed message="Couldn't load this class." onRetry={() => void reload()} />
			) : loading ? (
				// As tall as the fields, so the dialog doesn't jump when the class arrives.
				<p data-testid="class-dialog-loading" className="flex min-h-[420px] items-center justify-center text-[15px] text-ink-2">
					Loading…
				</p>
			) : (
				<>
					<label className="flex flex-col gap-1.5">
						<span className={LABEL_TEXT}>Name</span>
						<input
							type="text"
							data-testid="class-name"
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
							data-testid="class-description"
							value={description}
							disabled={busy}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Level, textbook, the professor's notation, what exams look like. The teacher reads this."
							className={`${FIELD} h-auto min-h-[84px] resize-y py-[9px] leading-[1.4]`}
						/>
					</label>
				</>
			)}
			{editing && (
				<>
					<ClassIconField icon={icon} disabled={busy} onChange={setIcon} />
					<ClassColorField color={color} disabled={busy} onChange={setColor} />
					<ClassSignatureField kind={signature.kind} value={signature.value} disabled={busy} onChange={(kind, value) => setSignature({ kind, value })} />
					<div className="flex flex-col gap-1.5">
						<span className={LABEL_TEXT}>Rules for this class</span>
						<span className="text-base text-ink-2">Added to your rules in every {editing.name} lesson</span>
						<RuleChips rules={rules} onChange={setRules} testid="class-rules" saved={savedTimes(savedRules, { classId: editing.id })} teacherName={teacherName} />
					</div>
				</>
			)}
			{errorLine}
		</DialogSheet>
	);
}
