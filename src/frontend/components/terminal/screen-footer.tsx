import { useRef } from "react";
import { ATTACHMENT_ACCEPT } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import type { TerminalFooter } from "./terminal-model";

const KEY = "lh-btn h-8 shrink-0 px-3 text-[14px]";

/**
 * The slim row under a screen: Attach and Paste at the left, the sentence
 * when there is one, then Stop, and the one bright key (the assist key or
 * Start again) at the far right. A key shows only while it can act.
 */
export function ScreenFooter({ text, onAttach, onPaste, onStop, get, assist, onStartAgain }: {
	text: string | null;
	onAttach: ((files: File[]) => void) | null;
	onPaste: (() => void) | null;
	onStop: (() => void) | null;
	get: TerminalFooter["get"];
	assist: { label: string; run: () => void } | null;
	onStartAgain: (() => void) | null;
}) {
	const picker = useRef<HTMLInputElement>(null);
	return (
		// In a narrow window the sentence takes its own line above the keys.
		<div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pb-2.5">
			{onAttach && (
				<>
					<input
						ref={picker}
						type="file"
						multiple
						hidden
						accept={ATTACHMENT_ACCEPT}
						data-testid="terminal-attach-input"
						onChange={(e) => {
							onAttach(Array.from(e.target.files ?? []));
							e.target.value = "";
						}}
					/>
					<button type="button" data-testid="terminal-attach" onClick={() => picker.current?.click()} className={KEY}>
						Attach
					</button>
				</>
			)}
			{onPaste && (
				<button type="button" data-testid="terminal-paste" onClick={onPaste} className={KEY}>
					Paste
				</button>
			)}
			<p data-testid="terminal-footer" role="status" className={cn("min-w-0 flex-1 px-1.5 text-[15px] leading-snug text-ink", text && "min-w-56")}>
				{text}
			</p>
			{onStop && (
				<button type="button" data-testid="terminal-stop" onClick={onStop} className={cn(KEY, "lh-btn-quiet")}>
					Stop
				</button>
			)}
			{get && (
				<button type="button" data-testid="terminal-get" onClick={() => void window.lh?.openLink?.(get.url)} className={KEY}>
					{get.label}
				</button>
			)}
			{assist && (
				<button type="button" data-testid="terminal-assist" onClick={assist.run} className={cn(KEY, "lh-btn-main")}>
					{assist.label}
				</button>
			)}
			{onStartAgain && (
				<button type="button" data-testid="terminal-start-again" onClick={onStartAgain} className={cn(KEY, "lh-btn-main")}>
					Start again
				</button>
			)}
		</div>
	);
}
