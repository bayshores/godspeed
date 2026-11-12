import type { RefObject } from "react";
import { AttachButton, AttachmentTray, attachmentInputProps, type AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/** Enter starts the lesson; Shift+Enter is a new line, and an IME
 *  composition's Enter only confirms the text. */
export function isStartKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
	return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}

/**
 * The topic box: the learner's topic, then "Start from facts" (opens the
 * fact picker; with picks it shows the count and "Clear"), "Add pictures
 * or PDFs" and the filled Study button. Enter starts, Shift+Enter is a new
 * line. Pictures and PDFs (paste, drop or the button) wait above the
 * topic, as in the lesson's writing box, and go with the first message.
 */
export function TopicBox({
	text,
	onText,
	onStart,
	busy,
	inputRef,
	picks,
	canPick,
	onOpenPicker,
	onClearPicks,
	attachments,
}: {
	text: string;
	onText: (text: string) => void;
	onStart: () => void;
	busy: boolean;
	inputRef?: RefObject<HTMLTextAreaElement | null>;
	/** How many facts are picked. */
	picks: number;
	/** The space has facts to pick from. */
	canPick: boolean;
	onOpenPicker: () => void;
	onClearPicks: () => void;
	attachments: AttachmentDraft;
}) {
	const empty = !text.trim() && picks === 0;
	return (
		<form
			data-testid="home-topic-box"
			className="flex min-h-[170px] w-full flex-col rounded border-[1.5px] border-ink bg-background pt-0.5 pr-2.5 pb-2.5 pl-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (empty) inputRef?.current?.focus();
				else onStart();
			}}
			{...attachmentInputProps(attachments)}
		>
			<AttachmentTray draft={attachments} />
			<textarea
				ref={inputRef}
				data-testid="home-topic-input"
				aria-label="What do you want to study?"
				value={text}
				onChange={(e) => onText(e.target.value)}
				onKeyDown={(e) => {
					if (isStartKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
						e.preventDefault();
						if (!empty) onStart();
					}
				}}
				placeholder="A topic, a homework method, or a question you're stuck on"
				autoFocus
				rows={2}
				className="field-sizing-content max-h-60 min-h-[86px] w-full flex-1 resize-none bg-transparent pt-3 pb-3 font-prose text-[17px] leading-snug text-ink outline-none placeholder:text-ink-3"
			/>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" data-testid="facts-picks-chip" disabled={!canPick && picks === 0} onClick={onOpenPicker} className="lh-btn text-[15px]">
					{picks > 0 ? `${picks} ${picks === 1 ? "fact" : "facts"} picked` : "Start from facts"}
				</button>
				{picks > 0 && (
					<button type="button" data-testid="facts-picks-clear" onClick={onClearPicks} className="lh-btn lh-btn-quiet text-[15px]">
						Clear
					</button>
				)}
				<AttachButton draft={attachments} outlined />
				<span className="flex-1" />
				<button type="submit" data-testid="home-start" aria-disabled={empty || busy} disabled={busy} className="lh-btn lh-btn-main shrink-0 text-[15px]">
					<PixelIcon name="play" />
					Study
				</button>
			</div>
		</form>
	);
}
