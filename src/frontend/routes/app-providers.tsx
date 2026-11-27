import type { ReactNode } from "react";
import type { BootInfo } from "@/shared/core";
import { DesktopEnv } from "@/frontend/components/desktop-env";
import { ServerEventsProvider } from "@/frontend/components/server-events";
import { SettingsProvider } from "@/frontend/components/settings-context";
import { TurnsRunningProvider } from "@/frontend/components/turns-running";
import { AppearanceProvider } from "@/frontend/components/settings/appearance";
import { SpaceProvider } from "@/frontend/components/space-context";
import { VaultProvider } from "@/frontend/components/vault/vault-context";
import { AgentFolderProvider } from "@/frontend/components/agent-folder/agent-folder-context";
import { AgentSetupProvider } from "@/frontend/components/agent-setup/agent-setup-context";
import { OpenDeadlinesProvider } from "@/frontend/components/use-open-deadlines";

/** What every window of the app stands on: the desktop marks, the server's events (the top bar,
 *  dock and pages all subscribe), settings, the turns running, the agent's folder and setup, spaces,
 *  the look, the notes folder and the open deadlines. The main window (root.tsx) and the chat window
 *  (chat-window.tsx) share it, so the teacher's ideas are made from the same facts in both. */
export function AppProviders({ boot, children }: { boot: BootInfo; children: ReactNode }) {
	return (
		<>
			<DesktopEnv />
			<ServerEventsProvider>
				<SettingsProvider boot={boot}>
					<TurnsRunningProvider>
						<AgentFolderProvider>
							<AgentSetupProvider>
								<SpaceProvider initialActive={boot.activeSpace} initialSpaces={boot.spaces}>
									<AppearanceProvider initial={boot.appearance}>
										<VaultProvider>
											<OpenDeadlinesProvider>{children}</OpenDeadlinesProvider>
										</VaultProvider>
									</AppearanceProvider>
								</SpaceProvider>
							</AgentSetupProvider>
						</AgentFolderProvider>
					</TurnsRunningProvider>
				</SettingsProvider>
			</ServerEventsProvider>
		</>
	);
}
