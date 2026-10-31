"use client";

/**
 * The old plugin or Codex block still on the computer, which loads
 * godspeed in chats outside the godspeed folder: a corner notice on app
 * start (Later hides it until the next start) and a line in Settings →
 * Connection that stays until Remove.
 */

import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { OUTLINE_BUTTON } from "@/components/settings/controls";
import { oldSetupLines, removedNote } from "./agent-folder-model";
import { useOldSetup } from "./use-old-setup";

export function OldSetupNotice() {
	const { view, removed, busy, error, remove } = useOldSetup();
	const [hidden, setHidden] = useState(false);
	if (hidden || !view) return null;
	const lines = oldSetupLines(view.oldSetup, view.short);
	if (!lines.length && !removed) return null;
	return (
		<div data-testid="old-setup-notice" role="status" className="lh-rise lh-glass flex w-[340px] max-w-full flex-col gap-3 px-4 py-3.5 font-ui text-[13.5px] text-ink">
			{removed ? (
				<p>{removedNote(removed)}</p>
			) : (
				lines.map((line) => <p key={line.short}>{line.full}</p>)
			)}
			{error && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
			<div className="flex items-center justify-end gap-4">
				{removed ? (
					<button type="button" onClick={() => setHidden(true)} className="lh-press bg-ink px-3 py-1.5 text-sm font-bold text-background hover:bg-ink/85">
						OK
					</button>
				) : (
					<>
						<button type="button" data-testid="old-setup-later" onClick={() => setHidden(true)} className="lh-press text-sm font-bold text-ink-2 hover:text-ink">
							Later
						</button>
						<button
							type="button"
							data-testid="old-setup-remove"
							disabled={busy}
							onClick={() => void remove()}
							className="lh-press bg-ink px-3 py-1.5 text-sm font-bold text-background hover:bg-ink/85 disabled:opacity-60"
						>
							Remove
						</button>
					</>
				)}
			</div>
		</div>
	);
}

export function OldSetupWarning() {
	const { view, removed, busy, error, remove } = useOldSetup();
	if (!view) return null;
	const lines = oldSetupLines(view.oldSetup, view.short);
	if (!lines.length) return removed ? <p className="pb-1 text-[13px] text-ink-2">{removedNote(removed)}</p> : null;
	return (
		<div data-testid="old-setup-warning" className="flex flex-col gap-1.5 pb-1">
			<div className="flex items-center justify-between gap-4">
				<span className="flex min-w-0 items-center gap-2 text-[13.5px] text-ink">
					<TriangleAlertIcon className="size-[13px] shrink-0 text-ans-wrong" aria-hidden />
					{lines.map((line) => line.short).join(" ")}
				</span>
				<button type="button" className={OUTLINE_BUTTON} disabled={busy} onClick={() => void remove()}>
					Remove
				</button>
			</div>
			{error && (
				<p role="alert" className="text-xs text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}
