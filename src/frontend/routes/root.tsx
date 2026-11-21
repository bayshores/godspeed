import { useEffect } from "react";
import { Outlet } from "react-router";
import { showsWelcome, useBoot } from "@/frontend/components/boot";
import { AppShell } from "@/frontend/components/app-shell";
import { ActivityProvider } from "@/frontend/components/activity-dock";
import UpdateBanner from "@/frontend/components/update-banner";
import { UpdateStateProvider } from "@/frontend/components/settings/update-settings";
import { SoundProvider } from "@/frontend/components/sounds";
import { Onboarding } from "@/frontend/components/onboarding/onboarding";
import { RestartNotice } from "@/frontend/components/restart-notice";
import { PeekSheet } from "@/frontend/components/strip/peek-sheet";
import { WhatsNew } from "@/frontend/components/whats-new";
import { FolderNotice } from "@/frontend/components/agent-folder/folder-notice";
import { OldSetupNotice } from "@/frontend/components/agent-folder/old-setup";
import { AppProviders } from "./app-providers";
import { PageTitle } from "./page-title";

/** Around every screen: the providers, the app frame (or the onboarding on
 *  first launch) and the notices. */
export function Root() {
	const { boot } = useBoot();
	const welcome = showsWelcome(boot);
	// The desktop window stays hidden until this first real screen is drawn
	// (main.tsx renders only once /api/boot has answered). AppearanceProvider's
	// effect runs first, so the window shows with the saved colors.
	useEffect(() => window.lh?.showWindow?.(), []);
	return (
		<AppProviders boot={boot}>
			<UpdateStateProvider>
				<div className="flex h-dvh flex-col">
					<ActivityProvider>
						<SoundProvider>
							{boot.onboarding ? (
								<>
									<PageTitle />
									<Onboarding />
								</>
							) : (
								<AppShell welcome={welcome} whatsNewSince={welcome ? boot.whatsNewSince : null}>
									<Outlet />
								</AppShell>
							)}
						</SoundProvider>
					</ActivityProvider>
				</div>
				{/* Auto-update banner (pushed by the desktop shell) and the restart notice. */}
				<PeekSheet>
					<UpdateBanner />
					{boot.firstLoad === "restarted" && <RestartNotice />}
					{!boot.onboarding && <OldSetupNotice />}
				</PeekSheet>
				{/* "What's new" after an update (after the welcome screen when it
				    shows); Settings reopens it. */}
				{!boot.onboarding && <WhatsNew since={welcome ? null : boot.whatsNewSince} />}
				{boot.folderNotice && <FolderNotice agent={boot.folderNotice} afterWelcome={welcome} />}
			</UpdateStateProvider>
		</AppProviders>
	);
}
