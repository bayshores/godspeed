/**
 * Settings → Teaching → Remembered: the notes outside agents saved with
 * remember, each with its space, its date and a Delete button.
 */

import { useCallback, useEffect, useState } from "react";
import { savedDay } from "@/frontend/components/rule-chips";
import { FootQuestion } from "@/frontend/components/ui/foot-question";
import { SMALL_KEY, SettingsGroup, SettingsRow } from "./controls.tsx";

interface NoteView {
	id: string;
	text: string;
	spaceName: string | null;
	createdAt: string;
}

async function request(query = "", init?: RequestInit): Promise<NoteView[]> {
	const res = await fetch(`/api/agent-notes${query}`, { cache: "no-store", ...init });
	if (!res.ok) throw new Error("Saved notes are unavailable.");
	return ((await res.json()) as { notes: NoteView[] }).notes;
}

function savedLabel(note: NoteView): string {
	const day = savedDay(note.createdAt);
	return note.spaceName ? `${note.spaceName}, saved ${day}` : `Saved ${day}`;
}

export function RememberedNotes() {
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

	return (
		<SettingsGroup label="Remembered" about="Notes your agent saved when you told it something worth keeping" testid="remembered-notes">
			{notes === null ? (
				<p>{error ?? "Loading…"}</p>
			) : notes.length === 0 ? (
				<p>Nothing yet. Your agent saves notes here when you tell it something worth keeping.</p>
			) : (
				notes.map((note) => (
					<div key={note.id}>
						<SettingsRow label={note.text} hint={savedLabel(note)}>
							{asking !== note.id && (
								<button type="button" aria-label={`Delete note: ${note.text}`} className={SMALL_KEY} disabled={busy} onClick={() => setAsking(note.id)}>
									Delete
								</button>
							)}
						</SettingsRow>
						{asking === note.id && (
							<div className="pb-3.5">
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
				))
			)}
			{notes && error && <p className="text-ans-wrong">{error}</p>}
		</SettingsGroup>
	);
}
