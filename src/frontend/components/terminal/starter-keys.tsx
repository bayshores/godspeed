import { useRef } from "react";
import { usePresence } from "@/frontend/components/presence";
import { ScreenKey } from "./screen-key";

/**
 * The row between the teacher's screen and its footer while the chat is
 * unused: "Try asking" and a key per starter, each sending its own words.
 * Keys wrap to a second line in a narrow window; the first, which can hold
 * a space's or a deadline's name, is cut short instead of taking two.
 */
export function StarterKeys({ starters, onSend }: { starters: readonly string[] | null; onSend: (line: string) => void }) {
	const shown = usePresence(starters !== null);
	// While it fades out it keeps its last words.
	const last = useRef(starters);
	if (starters) last.current = starters;
	if (!shown.mounted || !last.current) return null;
	return (
		<div data-testid="terminal-starters" data-state={shown.state} className="lh-fade flex shrink-0 items-start gap-x-2 px-3 pb-1">
			<span className="flex h-8 shrink-0 items-center px-1.5 font-mono text-[13px] leading-snug text-ink">Try asking</span>
			<div className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-1.5">
				{last.current.map((line, i) => (
					<ScreenKey key={line} testid="terminal-starter" onClick={starters && (() => onSend(line))} title={i === 0 ? line : undefined} className="max-w-full">
						<span className="truncate">{line}</span>
					</ScreenKey>
				))}
			</div>
		</div>
	);
}
