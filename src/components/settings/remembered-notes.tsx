/**
 * Settings → Connection → Remembered: the notes outside agents saved with
 * remember, each with its class, its date and a Delete button.
 */

import { useCallback, useEffect, useState } from "react";
import { OUTLINE_BUTTON, SettingsGroup, SettingsRow } from "./controls.tsx";

interface NoteView {
	id: string;
	text: string;
	className: string | null;
	createdAt: string;
}

async function request(query = "", init?: RequestInit): Promise<NoteView[]> {
	const res = await fetch(`/api/agent-notes${query}`, { cache: "no-store", ...init });
	if (!res.ok) throw new Error("Saved notes are unavailable.");
	return ((await res.json()) as { notes: NoteView[] }).notes;
}

function savedLabel(note: NoteView): string {
	const day = new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
	return note.className ? `${note.className}, saved ${day}` : `Saved ${day}`;
}

export function RememberedNotes() {
	const [notes, setNotes] = useState<NoteView[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback((query?: string, init?: RequestInit) => {
		request(query, init).then(
			(n) => {
				setNotes(n);
				setError(null);
			},
			(e: Error) => setError(e.message),
		);
	}, []);
	useEffect(() => load(), [load]);

	return (
		<SettingsGroup label="Remembered" testid="remembered-notes">
			{notes === null ? (
				<p className="text-xs text-ink-2">{error ?? "Loading…"}</p>
			) : notes.length === 0 ? (
				<p className="text-xs text-ink-2">Nothing yet. Your agent saves notes here when you tell it something worth keeping.</p>
			) : (
				notes.map((note) => (
					<SettingsRow key={note.id} label={note.text} hint={savedLabel(note)}>
						<button
							type="button"
							aria-label={`Delete note: ${note.text}`}
							className={OUTLINE_BUTTON}
							onClick={() => load(`?id=${encodeURIComponent(note.id)}`, { method: "DELETE" })}
						>
							Delete
						</button>
					</SettingsRow>
				))
			)}
			{notes && error && <p className="text-xs text-ans-wrong">{error}</p>}
		</SettingsGroup>
	);
}
