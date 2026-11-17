import { useRef } from "react";
import { ATTACHMENT_ACCEPT } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { ScreenKey } from "./screen-key";
import type { TerminalFooter } from "./terminal-model";

/**
 * The slim row under a screen: Attach and Paste at the left, the sentence
 * when there is one, then Stop, and the one bright key (the assist key or
 * Start again) at the far right. A key shows only while it can act, and
 * fades in and out.
 */
export function ScreenFooter({ text, onAttach, onPaste, onStop, get, assist, onStartAgain, again = "Start again", onNewChat = null }: {
	text: string | null;
	onAttach: ((files: File[]) => void) | null;
	onPaste: (() => void) | null;
	onStop: (() => void) | null;
	get: TerminalFooter["get"];
	assist: { label: string; run: () => void } | null;
	onStartAgain: (() => void) | null;
	/** Start again's word: "Continue" when it goes back to the chat that ended. */
	again?: string;
	/** Beside Continue: a new chat instead. */
	onNewChat?: (() => void) | null;
}) {
	const picker = useRef<HTMLInputElement>(null);
	return (
		// In a narrow window the sentence takes its own line above the keys.
		<div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pb-2.5">
			<input
				ref={picker}
				type="file"
				multiple
				hidden
				accept={ATTACHMENT_ACCEPT}
				data-testid="terminal-attach-input"
				onChange={(e) => {
					onAttach?.(Array.from(e.target.files ?? []));
					e.target.value = "";
				}}
			/>
			<ScreenKey testid="terminal-attach" onClick={onAttach && (() => picker.current?.click())} quiet>
				Attach
			</ScreenKey>
			<ScreenKey testid="terminal-paste" onClick={onPaste} quiet>
				Paste
			</ScreenKey>
			<p data-testid="terminal-footer" role="status" className={cn("min-w-0 flex-1 px-1.5 font-mono text-[13px] leading-snug text-ink", text && "min-w-56")}>
				{text}
			</p>
			<ScreenKey testid="terminal-stop" onClick={onStop} quiet>
				Stop
			</ScreenKey>
			<ScreenKey testid="terminal-get" onClick={get && (() => void window.lh?.openLink?.(get.url))}>
				{get?.label}
			</ScreenKey>
			<ScreenKey testid="terminal-assist" onClick={assist?.run ?? null} main>
				{assist?.label}
			</ScreenKey>
			<ScreenKey testid="terminal-new-chat" onClick={onNewChat} quiet>
				New chat
			</ScreenKey>
			<ScreenKey testid="terminal-start-again" onClick={onStartAgain} main>
				{again}
			</ScreenKey>
		</div>
	);
}

