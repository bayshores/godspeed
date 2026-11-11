import { useEffect } from "react";
import { Outlet } from "react-router";
import { showsWelcome, useBoot } from "@/frontend/components/boot";
import { SidebarProvider } from "@/frontend/components/sidebar";
import { AppShell } from "@/frontend/components/app-shell";
import { ActivityProvider } from "@/frontend/components/activity-dock";
import { ServerEventsProvider } from "@/frontend/components/server-events";
import { AgentStatusProvider } from "@/frontend/components/agent-status";
import { AppearanceProvider } from "@/frontend/components/settings/appearance";
import UpdateBanner from "@/frontend/components/update-banner";
import { ClassProvider } from "@/frontend/components/class-context";
import { SoundProvider } from "@/frontend/components/sounds";
import { Onboarding } from "@/frontend/components/onboarding/onboarding";
import { RestartNotice } from "@/frontend/components/restart-notice";
import { NoticeStack } from "@/frontend/components/notice-stack";
import { WhatsNew } from "@/frontend/components/whats-new";
import { FolderNotice } from "@/frontend/components/agent-folder/folder-notice";
import { OldSetupNotice } from "@/frontend/components/agent-folder/old-setup";
import { PageTitle } from "./page-title";

/** Around every screen: the providers, the app frame (or the onboarding on
 *  first launch) and the notices. */
export function Root() {
	const { boot } = useBoot();
	const welcome = showsWelcome(boot);
	// The desktop window stays hidden until this first real screen is drawn
	// (main.tsx renders only once /api/boot has answered).
	useEffect(() => window.lh?.showWindow?.(), []);
	return (
		<>
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
			    and pages all subscribe. */}
			<ServerEventsProvider>
				<AgentStatusProvider>
					<ClassProvider initialActive={boot.activeClass} initialClasses={boot.classes}>
						<AppearanceProvider>
							<SidebarProvider>
								<ActivityProvider>
									<SoundProvider initialOn={boot.sounds}>
										{boot.onboarding ? (
											<>
												<PageTitle />
												<Onboarding />
											</>
										) : (
											<AppShell teacherName={boot.teacherName} welcome={welcome} whatsNewSince={welcome ? boot.whatsNewSince : null}>
												<Outlet />
											</AppShell>
										)}
									</SoundProvider>
								</ActivityProvider>
							</SidebarProvider>
						</AppearanceProvider>
					</ClassProvider>
				</AgentStatusProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (pushed by the desktop shell) and the restart notice. */}
			<NoticeStack>
				<UpdateBanner />
				{boot.firstLoad === "restarted" && <RestartNotice />}
				{!boot.onboarding && <OldSetupNotice />}
			</NoticeStack>
			{/* "What's new" after an update (after the welcome screen when it
			    shows); Settings reopens it. */}
			{!boot.onboarding && <WhatsNew since={welcome ? null : boot.whatsNewSince} />}
			{boot.folderNotice && <FolderNotice agent={boot.folderNotice} afterWelcome={welcome} />}
		</>
	);
}
