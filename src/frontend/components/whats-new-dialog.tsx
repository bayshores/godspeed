/**
 * The "What's new" dialog body (src/frontend/components/whats-new.tsx opens it):
 * one dated list of changes per version, and a "Got it" button.
 */

import { useEffect } from "react";
import type { ChangelogEntry } from "@/shared/core";
import { DialogSheet } from "@/frontend/components/ui/dialog-sheet";

/** "2026-10-27" → "Oct 27, 2026" (fixed locale and zone: no hydration drift). */
export function formatChangelogDate(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return date;
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function WhatsNewDialog({
	entries,
	state,
	onClose,
}: {
	entries: ChangelogEntry[];
	state: "open" | "closed";
	onClose: () => void;
}) {
	useEffect(() => {
		if (state === "closed") return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		// Capture phase: it opens over Settings, whose own Esc listener must not see the key.
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [onClose, state]);

	const single = entries.length === 1;
	const title = single && entries[0] ? `What's new in ${entries[0].version}` : "What's new";
	return (
		<DialogSheet
			title={title}
			state={state}
			testid="whats-new"
			onClose={onClose}
			foot={
				<>
					<span className="flex-1" />
					<button type="button" data-autofocus data-testid="whats-new-done" onClick={onClose} className="lh-btn lh-btn-main text-[15px]">
						Got it
					</button>
				</>
			}
		>
			{entries.map((entry) => (
				<section key={entry.version} data-testid="whats-new-entry" className="mt-2 flex flex-col gap-3.5 first:mt-0">
					<p className="text-[15px] text-ink-2">{single ? formatChangelogDate(entry.date) : `${entry.version}, ${formatChangelogDate(entry.date)}`}</p>
					<ul className="flex flex-col gap-3.5">
						{entry.changes.map((change) => (
							<li key={change} className="flex gap-3 text-lg text-ink">
								<span aria-hidden className="mt-[9px] size-1.5 shrink-0 bg-ink" />
								<span>{change}</span>
							</li>
						))}
					</ul>
				</section>
			))}
		</DialogSheet>
	);
}
