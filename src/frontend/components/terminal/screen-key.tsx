import { useRef, type ReactNode } from "react";
import { usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";

/** In the screen's font, so the key reads as part of the screen. */
const KEY = "lh-btn h-8 shrink-0 font-mono text-[13px]";

/** A key under a screen, there while it can act (`onClick`), fading in and out. The
 *  everyday ones are plain words (`quiet`); the one to press now is bright (`main`). */
export function ScreenKey({ testid, onClick, main = false, quiet = false, title, className, children }: {
	testid: string;
	onClick: (() => void) | null;
	main?: boolean;
	quiet?: boolean;
	title?: string;
	className?: string;
	children: ReactNode;
}) {
	const shown = usePresence(!!onClick);
	// While it fades out it keeps its last words and does nothing.
	const last = useRef(children);
	if (onClick) last.current = children;
	if (!shown.mounted) return null;
	return (
		<button type="button" data-testid={testid} data-state={shown.state} title={title} onClick={() => onClick?.()} className={cn(KEY, "lh-fade", quiet ? "lh-btn-quiet" : "px-3", main && "lh-btn-main", className)}>
			{last.current}
		</button>
	);
}
