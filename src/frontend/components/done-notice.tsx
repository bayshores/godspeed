import { useEffect } from "react";
import { createPortal } from "react-dom";
import { NoticeCard } from "@/frontend/components/notice-card";
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
		<NoticeCard data-testid="done-notice" {...handlers} role="alert" title={text} />,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}
