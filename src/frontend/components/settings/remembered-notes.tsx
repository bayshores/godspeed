/**
 * Settings → Teaching → Remembered: the notes the teacher saved with
 * remember, each with its space, its date and a Delete button.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoadingLine, useWaited } from "@/frontend/components/loading";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { ErrorLine } from "@/frontend/components/error-line";
import { rowMotion } from "@/frontend/components/motion";
import { useLeavingList } from "@/frontend/components/presence";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { savedDay } from "@/frontend/components/rule-chips";
import { FootQuestion } from "@/frontend/components/ui/foot-question";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { send } from "@/frontend/lib/api";
import { cn } from "@/frontend/lib/utils";
import { SMALL_KEY, SettingsGroup, SettingsRow } from "./controls.tsx";

interface NoteView {
	id: string;
	text: string;
	spaceName: string | null;
	createdAt: string;
}

async function request(query = "", init?: RequestInit): Promise<NoteView[]> {
	const { error, body } = await send(`/api/agent-notes${query}`, { cache: "no-store", ...init });
	if (error) throw new Error("Saved notes are unavailable.");
	return (body as { notes: NoteView[] }).notes;
}

function savedLabel(note: NoteView): string {
	const day = savedDay(note.createdAt);
	return note.spaceName ? `${note.spaceName}, saved ${day}` : `Saved ${day}`;
}

export function RememberedNotes() {
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const [notes, setNotes] = useState<NoteView[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Delete waits for the request: a second click would 404 and show an error.
	const [busy, setBusy] = useState(false);
	// The note whose Delete asks first; one at a time.
	const [asking, setAsking] = useState<string | null>(null);

	const load = useCallback((query?: string, init?: RequestInit) => {
		setBusy(true);
		request(query, init)
			.then(
				(n) => {
					setNotes(n);
					setError(null);
				},
				(e: Error) => setError(e.message),
			)
			.finally(() => setBusy(false));
	}, []);
	useEffect(() => load(), [load]);
	const waited = useWaited(notes !== null);
	// A deleted note fades out in its place; its question (which rises in itself) fades out on Cancel.
	const listed = useLeavingList(useMemo(() => (notes ?? []).map((note) => ({ key: note.id, note })), [notes]));
	const question = useLastWhileClosing(asking);

	return (
		<SettingsGroup label="Remembered" about={`Notes ${teacher} saved when you told it something worth keeping`} testid="remembered-notes">
			{notes === null ? (
				error ? <p className="lh-rise">{error}</p> : <LoadingLine />
			) : listed.length === 0 ? (
				<p>Nothing yet. {teacher} saves notes here when you tell it something worth keeping.</p>
			) : (
				<div className={cn("contents", waited && "lh-set")}>
					{listed.map(({ item: { note }, leaving }) => (
						<div key={note.id} {...rowMotion(leaving, false)}>
							<SettingsRow label={note.text} hint={savedLabel(note)}>
								{asking !== note.id && (
									<button type="button" aria-label={`Delete note: ${note.text}`} className={SMALL_KEY} disabled={busy} onClick={() => setAsking(note.id)}>
										Delete
									</button>
								)}
							</SettingsRow>
							{question.mounted && question.shown === note.id && (
								<div {...rowMotion(question.state === "closed", false, "pb-3.5")}>
									<FootQuestion
										testid="note-delete-confirm"
										line="Delete this note?"
										keep="Cancel"
										go="Delete"
										busy={busy}
										onKeep={() => setAsking(null)}
										onGo={() => {
											setAsking(null);
											load(`?id=${encodeURIComponent(note.id)}`, { method: "DELETE" });
										}}
									/>
								</div>
							)}
						</div>
					))}
				</div>
			)}
			<ErrorLine error={notes && error} className="text-ans-wrong" />
		</SettingsGroup>
	);
}
