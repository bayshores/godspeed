import { NoticeCard } from "@/frontend/components/notice-card";
import { InNoticeStack } from "@/frontend/components/strip/peek-sheet";
import { useHeld } from "@/frontend/components/use-held";

/** How long the notice stays (it waits while the pointer or focus is on it). */
const NOTICE_MS = 6000;

/**
 * The short notice when ticking a deadline done, or undoing that, didn't
 * save. The update pop-up's card, in the notice stack (the page body when
 * there is none, as in tests).
 */
export function DoneNotice({ text, onExpire }: { text: string; onExpire: () => void }) {
	const handlers = useHeld(NOTICE_MS, onExpire, text);
	return (
		<InNoticeStack>
			<NoticeCard data-testid="done-notice" {...handlers} kind="error" timed title={text} />
		</InNoticeStack>
	);
}
