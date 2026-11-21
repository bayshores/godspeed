import type { ReactNode } from "react";
import type { BootInfo } from "@/shared/core";
import { DesktopEnv } from "@/frontend/components/desktop-env";
import { ServerEventsProvider } from "@/frontend/components/server-events";
import { SettingsProvider } from "@/frontend/components/settings-context";
import { AgentStatusProvider, useAgentStatus } from "@/frontend/components/agent-status";
import { AppearanceProvider } from "@/frontend/components/settings/appearance";
import { SpaceProvider } from "@/frontend/components/space-context";
import { TerminalsProvider } from "@/frontend/components/terminal/use-terminals";
import { VaultProvider } from "@/frontend/components/vault/vault-context";
import { AgentFolderProvider } from "@/frontend/components/agent-folder/agent-folder-context";

/** The agents' terminals follow the agent's live status, in the godspeed folder. */
function Terminals({ inTerminalWindow, children }: { inTerminalWindow: boolean; children: ReactNode }) {
	return (
		<AgentFolderProvider>
			<TerminalsProvider status={useAgentStatus()} inTerminalWindow={inTerminalWindow}>
				{children}
			</TerminalsProvider>
		</AgentFolderProvider>
	);
}

/** What every window of the app stands on: the desktop marks, the server's events (the top bar,
 *  dock and pages all subscribe), settings, the agent's status and terminals, spaces, the
 *  look and the notes folder. The main window (root.tsx) and the terminal window (terminal-window.tsx) share it. */
export function AppProviders({ boot, inTerminalWindow = false, children }: { boot: BootInfo; inTerminalWindow?: boolean; children: ReactNode }) {
	return (
		<>
			<DesktopEnv />
			<ServerEventsProvider>
				<SettingsProvider boot={boot}>
					<AgentStatusProvider>
						<Terminals inTerminalWindow={inTerminalWindow}>
							<SpaceProvider initialActive={boot.activeSpace} initialSpaces={boot.spaces}>
								<AppearanceProvider initial={boot.appearance}>{inTerminalWindow ? children : <VaultProvider>{children}</VaultProvider>}</AppearanceProvider>
							</SpaceProvider>
						</Terminals>
					</AgentStatusProvider>
				</SettingsProvider>
			</ServerEventsProvider>
		</>
	);
}
