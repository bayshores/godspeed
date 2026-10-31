import type { ReactNode } from "react";

/** The stack's element id: DoneNotice portals into it. */
export const NOTICE_STACK_ID = "lh-notices";

/** The bottom-right corner the notices (update, restart, deadline done)
 *  stack in, so they never cover each other. */
export function NoticeStack({ children }: { children: ReactNode }) {
	return (
		<div id={NOTICE_STACK_ID} className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 *:pointer-events-auto">
			{children}
		</div>
	);
}
