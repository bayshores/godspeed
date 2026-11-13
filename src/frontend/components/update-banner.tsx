/**
 * The update pop-up. The shell pushes "lh:update-status": the pop-up shows
 * as soon as an update starts downloading (with its progress), then offers
 * Restart now or Later once it is staged. Later hides it until the next
 * launch; a staged update installs on quit anyway (autoInstallOnAppQuit).
 * It sits under the welcome screen, so it appears once that closes.
 * Browser builds have no window.lh and never see a push: renders null.
 */

import { useState } from "react";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { useUpdateState } from "@/frontend/components/settings/update-settings.tsx";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";

export default function UpdateBanner() {
	const { state } = useUpdateState();
	const [later, setLater] = useState(false);
	const ready = state?.status === "downloaded";
	if ((!ready && state?.status !== "downloading") || (ready && later)) return null;
	const name = state.version ? `godspeed ${state.version}` : "A new godspeed";
	return (
		<NoticeCard
			data-testid="update-banner"
			role="status"
			title={ready ? `${name} is ready` : `${name} is downloading`}
			actions={
				ready && (
					<>
						<button type="button" data-testid="update-later" onClick={() => setLater(true)} className="lh-btn text-[15px]">
							Later
						</button>
						<button type="button" data-testid="update-restart-now" onClick={() => window.lh?.installUpdate?.()} className="lh-btn lh-btn-main text-[15px]">
							Restart now
						</button>
					</>
				)
			}
		>
			<NoticeText>{ready ? "Restart now to finish installing, or it installs the next time you quit." : "This happens in the background. Keep working."}</NoticeText>
			{!ready && <ProgressBar share={(state.percent ?? 0) / 100} className="w-full" />}
		</NoticeCard>
	);
}
