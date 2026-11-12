import { useEffect } from "react";
import { AgentLauncher } from "@/frontend/components/agent-folder/agent-launcher";
import { useSound } from "@/frontend/components/sounds";
import { StepSheet } from "./step-sheet";
import { useReturn } from "./use-return";

/** Step 1: start the agent in the godspeed folder and follow it live;
 *  "I'll do this later" skips it, Continue shows once it is connected. */
export function AgentStep({ connected, onNext }: { connected: boolean; onNext: () => void }) {
	const play = useSound();
	useEffect(() => {
		if (connected) play("connected");
	}, [connected, play]);
	useReturn(connected ? onNext : null);
	return (
		<StepSheet
			at={1}
			title="Start your agent"
			sub="godspeed doesn't have its own AI. Your agent teaches you from its own godspeed folder, on the plan you already have."
		>
			<AgentLauncher />
			<div className="flex items-center pt-2">
				{connected ? (
					<button type="button" data-testid="onboarding-agent-continue" className="lh-btn lh-btn-main ml-auto text-[15px]" onClick={onNext}>
						Continue
					</button>
				) : (
					<button type="button" data-testid="onboarding-later" className="lh-btn lh-btn-quiet text-[15px]" onClick={onNext}>
						I&apos;ll do this later
					</button>
				)}
			</div>
		</StepSheet>
	);
}
