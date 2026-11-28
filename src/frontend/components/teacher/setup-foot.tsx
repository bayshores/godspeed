import type { ReactNode } from "react";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";
import { useAgentFolderView } from "@/frontend/components/agent-folder/agent-folder-context";
import { AgentCompact, useReadySound } from "@/frontend/components/agent-setup/agent-card";
import { answered, cantRun } from "@/frontend/components/agent-setup/agent-card-model";
import { HeldSetup, useAgentSetup } from "@/frontend/components/agent-setup/agent-setup-context";
import { useFold } from "@/frontend/components/use-fold";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { cn } from "@/frontend/lib/utils";

/**
 * Whether the panel's teacher can be asked: true once a check found the agent can run, false while
 * one found it can't. While the picked agent's first check runs it stays as it was, so a pick of
 * the other agent never shows the box for a moment; at the window's start it is null.
 */
export function useAskable(): boolean | null {
	return useAgentSetup().askable;
}

/**
 * The foot of the teacher's chat. While the agent can't run, the writing row's place holds one
 * line: what stops the agent and the key that fixes it (the setup card's compact form), with the
 * other agent as a plain word under it. Once the agent can run, the line folds away with its last
 * words and the writing row (`children`) fades in in the same place. Before the first check
 * answers, neither shows.
 */
export function SetupFoot({ children }: { children: ReactNode }) {
	const { health } = useAgentSetup();
	const askable = useAskable();
	const line = useFold(askable === false);
	// The line under the held words never sees the agent come ready.
	useReadySound();
	return (
		<div className="grid shrink-0">
			{line.mounted && (
				<div data-testid="panel-setup" data-state={line.state} className="lh-collapse self-end [grid-area:1/1]">
					<div>
						<div data-state={line.state} className={cn("flex flex-col gap-1 px-[18px] pt-2.5 pb-[18px]", line.state === "closed" && "lh-fade")}>
							{/* Its words stay while it folds away, and while the other agent's first check runs. */}
							<HeldSetup hold={!(answered(health) && cantRun(health))}>
								<AgentCompact className="min-h-[52px] justify-center" />
								<OtherAgent />
							</HeldSetup>
						</div>
					</div>
				</div>
			)}
			{/* Kept under the line, so the box's words and its height stay. */}
			<div
				inert={askable !== true}
				className={cn(
					"flex flex-col self-end [grid-area:1/1] transition-[opacity,visibility] duration-(--lh-dur) ease-(--lh-ease-out)",
					askable === true ? "visible opacity-100 delay-(--lh-dur-fast)" : "invisible opacity-0",
				)}
			>
				{children}
			</div>
		</div>
	);
}

/** The other agent, as a plain word: a pick checks that one instead. */
function OtherAgent() {
	const { health } = useAgentSetup();
	const { pick } = useAgentFolderView();
	const action = useGuardedAction();
	const other = health?.agent === "codex" ? "claude" : "codex";
	return (
		<div className="flex min-h-9 flex-col items-end justify-center gap-1">
			<button
				type="button"
				data-testid="panel-setup-other"
				disabled={action.busy}
				onClick={() => void action.run(() => pick(other))}
				className="lh-btn lh-btn-quiet shrink-0"
			>
				Use {AGENT_LABEL[other]}
			</button>
			{action.error && (
				<p role="alert" className="text-ui text-ans-wrong">
					{action.error}
				</p>
			)}
		</div>
	);
}
