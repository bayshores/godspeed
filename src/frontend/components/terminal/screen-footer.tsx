import { useRef, type ReactNode } from "react";
import { ATTACHMENT_ACCEPT } from "@/shared/core";
import { usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import type { TerminalFooter } from "./terminal-model";

/** In the screen's font, so the row reads as part of the screen. */
const KEY = "lh-btn h-8 shrink-0 font-mono text-[13px]";

/**
 * The slim row under a screen: Attach and Paste at the left, the sentence
 * when there is one, then Stop, and the one bright key (the assist key or
 * Start again) at the far right. A key shows only while it can act, and
 * fades in and out.
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
			<Key testid="terminal-attach" onClick={onAttach && (() => picker.current?.click())} quiet>
				Attach
			</Key>
			<Key testid="terminal-paste" onClick={onPaste} quiet>
				Paste
			</Key>
			<p data-testid="terminal-footer" role="status" className={cn("min-w-0 flex-1 px-1.5 font-mono text-[13px] leading-snug text-ink", text && "min-w-56")}>
				{text}
			</p>
			<Key testid="terminal-stop" onClick={onStop} quiet>
				Stop
			</Key>
			<Key testid="terminal-get" onClick={get && (() => void window.lh?.openLink?.(get.url))}>
				{get?.label}
			</Key>
			<Key testid="terminal-assist" onClick={assist?.run ?? null} main>
				{assist?.label}
			</Key>
			<Key testid="terminal-start-again" onClick={onStartAgain} main>
				Start again
			</Key>
		</div>
	);
}

/** A key that is there while it can act (`onClick`), fading in and out. The
 *  everyday ones are plain words (`quiet`); the one to press now is bright (`main`). */
function Key({ testid, onClick, main = false, quiet = false, children }: { testid: string; onClick: (() => void) | null; main?: boolean; quiet?: boolean; children: ReactNode }) {
	const shown = usePresence(!!onClick);
	// While it fades out it keeps its last words and does nothing.
	const last = useRef(children);
	if (onClick) last.current = children;
	if (!shown.mounted) return null;
	return (
		<button type="button" data-testid={testid} data-state={shown.state} onClick={() => onClick?.()} className={cn(KEY, "lh-fade", quiet ? "lh-btn-quiet" : "px-3", main && "lh-btn-main")}>
			{last.current}
		</button>
	);
}
