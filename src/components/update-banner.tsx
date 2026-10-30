"use client";

/**
 * The update pop-up. The shell pushes "lh:update-status": the pop-up shows
 * as soon as an update starts downloading (with its progress), then offers
 * Restart now or Later once it is staged. Later hides it until the next
 * launch; a staged update installs on quit anyway (autoInstallOnAppQuit).
 * It sits under the welcome screen, so it appears once that closes.
 * Browser builds have no window.lh and never see a push: renders null.
 */

import { useState } from "react";
import { useUpdateState } from "@/components/settings/update-settings.tsx";

export default function UpdateBanner() {
	const { state } = useUpdateState();
	const [later, setLater] = useState(false);
	const ready = state?.status === "downloaded";
	if ((!ready && state?.status !== "downloading") || (ready && later)) return null;
	const name = state.version ? `godspeed ${state.version}` : "A new godspeed";
	return (
		<div data-testid="update-banner" role="status" className="lh-rise lh-glass fixed right-4 bottom-4 z-50 flex w-[320px] flex-col gap-3 px-4 py-3.5 font-ui">
			<div className="flex flex-col gap-1">
				<span className="text-[15px] font-bold text-ink">{ready ? `${name} is ready` : `${name} is downloading`}</span>
				<span className="text-sm text-ink-2">
					{ready ? "Restart now to finish installing, or it installs the next time you quit." : "This happens in the background. Keep working."}
				</span>
			</div>
			{ready ? (
				<div className="flex gap-2">
					<button
						type="button"
						data-testid="update-restart-now"
						onClick={() => window.lh?.installUpdate?.()}
						className="lh-press bg-ink px-3 py-1.5 text-sm font-bold text-background hover:bg-ink/85"
					>
						Restart now
					</button>
					<button
						type="button"
						data-testid="update-later"
						onClick={() => setLater(true)}
						className="lh-press px-3 py-1.5 text-sm font-bold text-ink hover:bg-tone"
					>
						Later
					</button>
				</div>
			) : (
				<div className="h-1 w-full bg-tone-2" aria-hidden>
					<div className="h-full bg-ink transition-[width] duration-(--lh-dur)" style={{ width: `${state.percent ?? 0}%` }} />
				</div>
			)}
		</div>
	);
}
