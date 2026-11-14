import { useEffect } from "react";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { Outlet } from "react-router";
import { showsWelcome, useBoot } from "@/frontend/components/boot";
import { DesktopEnv } from "@/frontend/components/desktop-env";
import { AppShell } from "@/frontend/components/app-shell";
import { ActivityProvider } from "@/frontend/components/activity-dock";
import { ServerEventsProvider } from "@/frontend/components/server-events";
import { AgentStatusProvider, useAgentStatus } from "@/frontend/components/agent-status";
import { AppearanceProvider } from "@/frontend/components/settings/appearance";
import UpdateBanner from "@/frontend/components/update-banner";
import { SpaceProvider } from "@/frontend/components/space-context";
import { SoundProvider } from "@/frontend/components/sounds";
import { Onboarding } from "@/frontend/components/onboarding/onboarding";
import { RestartNotice } from "@/frontend/components/restart-notice";
import { NoticeStack } from "@/frontend/components/notice-stack";
import { WhatsNew } from "@/frontend/components/whats-new";
import { FolderNotice } from "@/frontend/components/agent-folder/folder-notice";
import { OldSetupNotice } from "@/frontend/components/agent-folder/old-setup";
import { TerminalsProvider } from "@/frontend/components/terminal/use-terminals";
import { TerminalOverlay } from "@/frontend/components/terminal/terminal-overlay";
import { PageTitle } from "./page-title";

/** The agents' terminals follow the agent's live status. */
function Terminals({ children }: { children: React.ReactNode }) {
	return <TerminalsProvider status={useAgentStatus()}>{children}</TerminalsProvider>;
}

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
		<>
			<DesktopEnv />
			{/* The notification channel rides OUTSIDE everything: the top bar,
			    dock and pages all subscribe. */}
			<ServerEventsProvider>
				<AgentStatusProvider>
					<Terminals>
						<SpaceProvider initialActive={boot.activeSpace} initialSpaces={boot.spaces}>
							<AppearanceProvider initial={boot.appearance}>
								<div className="flex h-dvh flex-col">
									<ActivityProvider>
										<SoundProvider initialOn={boot.sounds}>
											{boot.onboarding ? (
												<>
													<PageTitle />
													<Onboarding />
													{/* Past the agent step a question still shows; the step shows its own screen. */}
													<TerminalOverlay name={boot.teacherName ?? DEFAULT_TEACHER_NAME} />
												</>
											) : (
												<AppShell teacherName={boot.teacherName} welcome={welcome} whatsNewSince={welcome ? boot.whatsNewSince : null}>
													<Outlet />
												</AppShell>
											)}
										</SoundProvider>
									</ActivityProvider>
								</div>
							</AppearanceProvider>
						</SpaceProvider>
						{/* Auto-update banner (pushed by the desktop shell) and the restart notice. */}
						<NoticeStack>
							<UpdateBanner teacherName={boot.teacherName ?? DEFAULT_TEACHER_NAME} />
							{boot.firstLoad === "restarted" && <RestartNotice />}
							{!boot.onboarding && <OldSetupNotice />}
						</NoticeStack>
						{/* "What's new" after an update (after the welcome screen when it
						    shows); Settings reopens it. */}
						{!boot.onboarding && <WhatsNew since={welcome ? null : boot.whatsNewSince} />}
						{boot.folderNotice && <FolderNotice agent={boot.folderNotice} afterWelcome={welcome} />}
					</Terminals>
				</AgentStatusProvider>
			</ServerEventsProvider>
		</>
	);
}
