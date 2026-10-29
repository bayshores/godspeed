/**
 * The "What's new" dialog body (src/components/whats-new.tsx opens it).
 * Same shell as the class dialog: square panel, tone outline, header with
 * a close button, one white button in the footer.
 */

import { useEffect } from "react";
import { XIcon } from "lucide-react";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import type { ChangelogEntry } from "@/core";

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
	const backdropDismiss = useBackdropDismiss(onClose);
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

	const single = entries.length === 1;
	const title = single && entries[0] ? `What's new in ${entries[0].version}` : "What's new";
	return (
		<div data-state={state} inert={state === "closed"} className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				data-testid="whats-new"
				data-state={state}
				className="lh-dialog flex max-h-[85vh] w-[480px] max-w-[calc(100vw-2rem)] flex-col bg-panel shadow-[0_0_40px_#000000e6] outline outline-1 -outline-offset-1 outline-tone-2"
			>
				<div className="flex shrink-0 items-center justify-between px-5 py-[18px]">
					<h2 className="text-base font-bold text-ink">{title}</h2>
					<button type="button" aria-label="Close" data-testid="whats-new-close" onClick={onClose} className="lh-press text-ink-2 hover:text-ink">
						<XIcon className="size-4" aria-hidden />
					</button>
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
					{entries.map((entry) => (
						<section key={entry.version} data-testid="whats-new-entry" className="flex flex-col gap-2">
							<p className="text-[13px] font-bold text-ink-2">
								{single ? formatChangelogDate(entry.date) : `${entry.version} · ${formatChangelogDate(entry.date)}`}
							</p>
							<ul className="flex flex-col gap-1.5">
								{entry.changes.map((change) => (
									<li key={change} className="flex gap-2.5 text-[14.5px] leading-[21px] text-ink">
										<span aria-hidden className="mt-[8px] size-[5px] shrink-0 bg-ink-3" />
										<span>{change}</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
				<div className="flex shrink-0 justify-end border-t border-tone-2 px-5 py-3.5">
					<button
						type="button"
						autoFocus
						data-testid="whats-new-done"
						onClick={onClose}
						className="lh-press bg-ink px-4 py-[9px] text-sm font-extrabold text-background hover:bg-ink-max"
					>
						Got it
					</button>
				</div>
			</div>
		</div>
	);
}
