import type { RefObject } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { AttachButton, AttachmentTray, attachmentInputProps, type AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";

/** Enter starts the lesson; Shift+Enter is a new line, and an IME
 *  composition's Enter only confirms the text. */
export function isStartKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
	return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}

/**
 * The topic box: the learner's topic, then "Start from facts" (opens the
 * fact picker; with picks it shows the count and a clear button) and the
 * white Study button. Enter starts, Shift+Enter is a new line. Pictures
 * and PDFs (paste, drop or the picture button) wait above the topic, as in
 * the lesson box, and go with the first message.
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
	/** The class has facts to pick from. */
	canPick: boolean;
	onOpenPicker: () => void;
	onClearPicks: () => void;
	attachments: AttachmentDraft;
}) {
	const empty = !text.trim() && picks === 0;
	return (
		<form
			data-testid="home-topic-box"
			className="flex min-h-[132px] w-full flex-col justify-between bg-panel outline outline-1 -outline-offset-1 outline-tone-2 focus-within:outline-ink-3"
			onSubmit={(e) => {
				e.preventDefault();
				if (empty) inputRef?.current?.focus();
				else onStart();
			}}
			{...attachmentInputProps(attachments)}
		>
			<div className="px-[18px]">
				<AttachmentTray draft={attachments} />
			</div>
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
				placeholder="A topic, a homework method, or a question you're stuck on…"
				autoFocus
				rows={2}
				className="field-sizing-content lh-input max-h-60 min-h-[86px] w-full resize-none bg-transparent px-[18px] py-4 text-[17px] leading-snug text-ink outline-none placeholder:text-ink-3"
			/>
			<div className="flex items-center justify-between gap-3 pl-3.5">
				<div className="flex min-w-0 items-center gap-1">
					<button
						type="button"
						data-testid="facts-picks-chip"
						disabled={!canPick && picks === 0}
						onClick={onOpenPicker}
						className="lh-press flex items-center gap-1.5 py-1 text-[13.5px] text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
					>
						<PlusIcon aria-hidden className="size-[13px]" />
						{picks > 0 ? (
							<span>
								<span className="font-mono tabular-nums">{picks}</span> {picks === 1 ? "fact" : "facts"} picked
							</span>
						) : (
							"Start from facts"
						)}
					</button>
					{picks > 0 && (
						<button
							type="button"
							data-testid="facts-picks-clear"
							aria-label="Clear picked facts"
							onClick={onClearPicks}
							className="lh-press lh-fade flex size-6 items-center justify-center text-ink-3 hover:text-ink"
						>
							<XIcon aria-hidden className="size-3.5" />
						</button>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<AttachButton draft={attachments} />
					<button
						type="submit"
						data-testid="home-start"
						aria-disabled={empty || busy}
						disabled={busy}
						className="lh-press flex shrink-0 items-center gap-2 self-stretch bg-ink px-[18px] py-3 text-[14.5px] font-extrabold text-background hover:bg-ink-max disabled:opacity-60"
					>
						Study
					</button>
				</div>
			</div>
		</form>
	);
}
