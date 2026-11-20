import { useRef } from "react";
import { usePresence } from "@/frontend/components/presence";
import { ScreenKey } from "./screen-key";

/**
 * The row between the teacher's screen and its footer: "Try asking", a key
 * per starter, each sending its own words, and the key that opens the whole
 * list. Keys wrap to more lines in a narrow window; one that holds a space's
 * or a deadline's name is cut short instead of taking two.
 */
export function StarterKeys({ starters, onSend, everything }: {
	starters: readonly string[] | null;
	onSend: (line: string) => void;
	/** The key for the whole list: its words, whether the list shows, and the press. */
	everything: { label: string; open: boolean; toggle: () => void };
}) {
	const shown = usePresence(starters !== null);
	// While it fades out it keeps its last words.
	const last = useRef(starters);
	if (starters) last.current = starters;
	if (!shown.mounted || !last.current) return null;
	return (
		<div data-testid="terminal-starters" data-state={shown.state} className="lh-fade flex shrink-0 items-start gap-x-2 px-3 pb-1">
			<span className="flex h-8 shrink-0 items-center px-1.5 font-mono text-[13px] leading-snug text-ink">Try asking</span>
			<div className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-1.5">
				{last.current.map((line) => (
					<ScreenKey key={line} testid="terminal-starter" onClick={starters && (() => onSend(line))} title={line} className="max-w-full">
						<span className="truncate">{line}</span>
					</ScreenKey>
				))}
				<ScreenKey testid="terminal-everything" onClick={starters && everything.toggle} held={everything.open} quiet>
					{everything.label}
				</ScreenKey>
			</div>
		</div>
	);
}
