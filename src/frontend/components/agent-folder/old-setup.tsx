/**
 * The old plugin or Codex block still on the computer, which loads
 * godspeed in chats outside the godspeed folder: a corner notice on app
 * start (Later hides it until the next start) and a line in Settings →
 * Connection that stays until Remove.
 */

import { useState } from "react";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { SMALL_KEY } from "@/frontend/components/settings/controls";
import { oldSetupLines, removedNote } from "./agent-folder-model";
import { useOldSetup } from "./use-old-setup";

export function OldSetupNotice() {
	const { view, removed, busy, error, remove } = useOldSetup();
	const [hidden, setHidden] = useState(false);
	if (hidden || !view) return null;
	const lines = oldSetupLines(view.oldSetup, view.short);
	if (!lines.length && !removed) return null;
	const [title, rest] = removed ? [removedNote(removed), ""] : splitSentence(lines[0]!.full);
	return (
		<NoticeCard
			data-testid="old-setup-notice"
			role="status"
			title={title}
			actions={
				removed ? (
					<button type="button" onClick={() => setHidden(true)} className="lh-btn text-[15px]">
						OK
					</button>
				) : (
					<>
						<button type="button" data-testid="old-setup-later" onClick={() => setHidden(true)} className="lh-btn text-[15px]">
							Later
						</button>
						<button type="button" data-testid="old-setup-remove" disabled={busy} onClick={() => void remove()} className="lh-btn text-[15px]">
							Remove
						</button>
					</>
				)
			}
		>
			{rest && <NoticeText>{rest}</NoticeText>}
			{!removed && lines.slice(1).map((line) => <NoticeText key={line.short}>{line.full}</NoticeText>)}
			{error && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
		</NoticeCard>
	);
}

/** "A. B." into ["A.", "B."]: the notice's title and its body. */
function splitSentence(text: string): [string, string] {
	const at = text.indexOf(". ");
	return at < 0 ? [text, ""] : [text.slice(0, at + 1), text.slice(at + 2)];
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
					{lines.map((line) => line.short).join(" ")}
				</span>
				<button type="button" className={SMALL_KEY} disabled={busy} onClick={() => void remove()}>
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
