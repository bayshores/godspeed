"use client";

import { useState } from "react";
import { SquareIcon } from "lucide-react";
import type { ChatAttachment, CheatSheetPrompt } from "@/core";
import { BrailleSpinner } from "@/components/braille-spinner";
import { isStartKey } from "@/components/home/topic-box";
import { AttachButton, AttachmentTray, attachmentInputProps, useAttachmentDraft } from "@/components/lesson/attachment-tray";
import { ActionBar } from "@/components/lesson/panel-parts";
import { cn } from "@/lib/utils";

/** What's typed in a sheet's box, for this app run: leaving the studio
 *  and coming back keeps it. */
const drafts = new Map<string, string>();

/**
 * The box the learner asks for the sheet in: their words, pictures and
 * PDFs (paste, drop or the picture button), and Make or Send; Stop while
 * the agent works. A refused send puts it all back.
 */
export function PromptBox({
	deadlineId,
	label,
	placeholder,
	disabled,
	running,
	onSend,
	onStop,
}: {
	deadlineId: string;
	/** "Make" for the first sheet, "Send" for a change. */
	label: string;
	placeholder: string;
	/** The prompt the agent is working on (Stop puts it back in an empty box), or null. */
	running: string | null;
	/** A newer godspeed saved the sheet: nothing can be sent. */
	disabled?: boolean;
	/** Resolves to the error line, or null once the request started. */
	onSend: (text: string, files: ChatAttachment[]) => Promise<string | null>;
	onStop: () => void;
}) {
	const attachments = useAttachmentDraft(`cheat-sheet:${deadlineId}`);
	const [text, setTextState] = useState(() => drafts.get(deadlineId) ?? "");
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const setText = (next: string) => {
		setTextState(next);
		if (next) drafts.set(deadlineId, next);
		else drafts.delete(deadlineId);
	};
	const busy = running !== null;
	const empty = !text.trim() && attachments.files.length === 0;
	const send = async () => {
		if (empty || busy || sending || disabled) return;
		const files = attachments.files;
		const sent = text;
		setSending(true);
		setText("");
		attachments.clear();
		const failed = await onSend(sent.trim(), files.map((f) => f.attachment));
		setSending(false);
		setError(failed);
		if (failed) {
			setText(sent);
			attachments.restore(files);
		}
	};

	return (
		<form
			data-testid="cheat-sheet-box"
			className="flex w-full flex-col bg-panel outline outline-1 -outline-offset-1 outline-tone-2 focus-within:outline-ink-3"
			onSubmit={(e) => {
				e.preventDefault();
				void send();
			}}
			{...attachmentInputProps(attachments)}
		>
			<div className="px-[18px]">
				<AttachmentTray draft={attachments} />
			</div>
			<textarea
				data-testid="cheat-sheet-prompt"
				aria-label={placeholder}
				value={text}
				disabled={disabled}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (isStartKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
						e.preventDefault();
						void send();
					}
				}}
				placeholder={placeholder}
				rows={3}
				className="field-sizing-content lh-input max-h-60 min-h-[86px] w-full resize-none bg-transparent px-[18px] py-4 text-[15px] leading-snug text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
			/>
			{error && (
				<p role="alert" className="px-[18px] pb-2 text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
			<div className="flex items-stretch">
				<AttachButton draft={attachments} />
				<div className="min-w-0 flex-1">
					{busy ? (
						<ActionBar
							testId="cheat-sheet-stop"
							waiting
							onClick={() => {
								onStop();
								if (!text.trim() && running) setText(running);
							}}
							label={
								<span className="flex items-center gap-2">
									<SquareIcon aria-hidden className="size-3.5" />
									Stop
								</span>
							}
						/>
					) : (
						<ActionBar type="submit" testId="cheat-sheet-send" disabled={empty || sending || disabled} label={label} />
					)}
				</div>
			</div>
		</form>
	);
}

/** What the learner asked, oldest first, then the request the agent is on
 *  or why the last one failed, with Try again. */
export function PromptHistory({
	prompts,
	running,
	error,
	agentName,
	waiting,
	onRetry,
	className,
}: {
	prompts: readonly CheatSheetPrompt[];
	running: string | null;
	error: string | null;
	agentName: string;
	/** No agent connected: the request waits for one. */
	waiting: boolean;
	onRetry: () => void;
	className?: string;
}) {
	if (prompts.length === 0 && running === null && !error) return null;
	return (
		<ol data-testid="cheat-sheet-history" className={cn("flex flex-col gap-3", className)}>
			{prompts.map((p, i) => (
				<li key={`${p.at}-${i}`} data-testid="cheat-sheet-asked" className="flex flex-col gap-0.5">
					<p className="text-[14px] leading-snug whitespace-pre-wrap text-ink">{p.text || "(files only)"}</p>
					{p.files && <p className="truncate text-[12.5px] text-ink-3">With {p.files.join(", ")}</p>}
				</li>
			))}
			{running !== null && (
				<li data-testid="cheat-sheet-asking" className="flex flex-col gap-1">
					{running && <p className="text-[14px] leading-snug whitespace-pre-wrap text-ink-2">{running}</p>}
					<p className="flex items-center gap-2 text-[13px] text-ink-3">
						<BrailleSpinner className="h-3 text-ink-3" />
						{waiting ? "Waiting for an agent" : `${agentName} is on it`}
					</p>
				</li>
			)}
			{error && running === null && (
				<li data-testid="cheat-sheet-failed" className="text-[13px] text-ink-2">
					<span className="text-ans-wrong">{agentName} couldn&apos;t finish that.</span> {error}{" "}
					<button type="button" data-testid="cheat-sheet-retry" onClick={onRetry} className="lh-press font-bold text-ink underline underline-offset-2">
						Try again
					</button>
				</li>
			)}
		</ol>
	);
}
