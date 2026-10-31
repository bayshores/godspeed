"use client";

/**
 * Shown on the first page after the desktop app restarted its crashed
 * server, so the reload has a reason. Same card as the update pop-up.
 */

import { useState } from "react";

export function RestartNotice() {
	const [open, setOpen] = useState(true);
	if (!open) return null;
	return (
		<div data-testid="restart-notice" role="status" className="lh-rise lh-glass flex w-[320px] flex-col gap-3 px-4 py-3.5 font-ui">
			<span className="text-[15px] font-bold text-ink">godspeed restarted after a problem</span>
			<button
				type="button"
				onClick={() => setOpen(false)}
				className="lh-press self-start bg-ink px-3 py-1.5 text-sm font-bold text-background hover:bg-ink/85"
			>
				OK
			</button>
		</div>
	);
}
