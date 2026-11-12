"use client";

/**
 * Shown on the first page after the desktop app restarted its crashed
 * server, so the reload has a reason. Same card as the update pop-up.
 */

import { useState } from "react";
import { NoticeCard } from "@/frontend/components/notice-card";

export function RestartNotice() {
	const [open, setOpen] = useState(true);
	if (!open) return null;
	return (
		<NoticeCard
			data-testid="restart-notice"
			role="status"
			title="godspeed restarted after a problem"
			actions={
				<button type="button" onClick={() => setOpen(false)} className="lh-btn text-[15px]">
					OK
				</button>
			}
		/>
	);
}
