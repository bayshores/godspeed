import { useEffect } from "react";
import { createPortal } from "react-dom";
import { NOTICE_STACK_ID } from "@/frontend/components/notice-stack";
import { useHeld } from "@/frontend/components/use-held";

/** How long the notice stays (it waits while the pointer or focus is on it). */
const NOTICE_MS = 6000;

/**
 * The short notice when ticking a deadline done, or undoing that, didn't
 * save. The update pop-up's card, in the notice stack (the page body when
 * there is none, as in tests).
 */
export function DoneNotice({ text, onExpire }: { text: string; onExpire: () => void }) {
	const { held, handlers } = useHeld();
	useEffect(() => {
		if (held) return;
		const timer = setTimeout(onExpire, NOTICE_MS);
		return () => clearTimeout(timer);
	}, [text, held, onExpire]);
	return createPortal(
		<div data-testid="done-notice" {...handlers} role="alert" className="lh-rise lh-popup flex items-center gap-2.5 px-4 py-2.5 font-ui text-sm text-ink">
			{text}
		</div>,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}
