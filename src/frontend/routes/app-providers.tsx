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

/** What every window of the app stands on: the desktop marks, the server's events (the top bar,
 *  dock and pages all subscribe), settings, the turns running, the agent's folder and setup, spaces,
 *  the look and the notes folder. The main window (root.tsx) and the chat window (chat-window.tsx) share it. */
export function AppProviders({ boot, inChatWindow = false, children }: { boot: BootInfo; inChatWindow?: boolean; children: ReactNode }) {
	return (
		<>
			<DesktopEnv />
			<ServerEventsProvider>
				<SettingsProvider boot={boot}>
					<TurnsRunningProvider>
						<AgentFolderProvider>
							<AgentSetupProvider>
								<SpaceProvider initialActive={boot.activeSpace} initialSpaces={boot.spaces}>
									<AppearanceProvider initial={boot.appearance}>{inChatWindow ? children : <VaultProvider>{children}</VaultProvider>}</AppearanceProvider>
								</SpaceProvider>
							</AgentSetupProvider>
						</AgentFolderProvider>
					</TurnsRunningProvider>
				</SettingsProvider>
			</ServerEventsProvider>
		</>
	);
}
