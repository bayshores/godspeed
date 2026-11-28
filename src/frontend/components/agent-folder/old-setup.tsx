/**
 * The old plugin or Codex block still on the computer, which loads
 * godspeed in chats outside the godspeed folder: a corner notice on app
 * start, which Later hides until the next start.
 */

import { useState } from "react";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { oldSetupLines, removedNote } from "./agent-folder-model";
import { useOldSetup } from "./use-old-setup";
import { ErrorLine } from "@/frontend/components/error-line";

export function OldSetupNotice() {
	const { view, removed, busy, error, remove } = useOldSetup();
	const [hidden, setHidden] = useState(false);
	if (hidden || !view) return null;
	const lines = oldSetupLines(view.oldSetup, view.short);
	if (!lines.length && !removed) return null;
	const [title, rest] = removed ? [removedNote(removed), ""] : splitSentence(lines[0]!);
	return (
		<NoticeCard
			data-testid="old-setup-notice"
			title={title}
			actions={
				removed ? (
					<button type="button" onClick={() => setHidden(true)} className="lh-btn">
						OK
					</button>
				) : (
					<>
						<button type="button" data-testid="old-setup-later" onClick={() => setHidden(true)} className="lh-btn">
							Later
						</button>
						<button type="button" data-testid="old-setup-remove" disabled={busy} onClick={() => void remove()} className="lh-btn">
							Remove
						</button>
					</>
				)
			}
		>
			{rest && <NoticeText>{rest}</NoticeText>}
			{!removed && lines.slice(1).map((line) => <NoticeText key={line}>{line}</NoticeText>)}
			<ErrorLine error={error} className="text-(length:--text-sm) text-ans-wrong" />
		</NoticeCard>
	);
}

/** "A. B." into ["A.", "B."]: the notice's title and its body. */
function splitSentence(text: string): [string, string] {
	const at = text.indexOf(". ");
	return at < 0 ? [text, ""] : [text.slice(0, at + 1), text.slice(at + 2)];
}
