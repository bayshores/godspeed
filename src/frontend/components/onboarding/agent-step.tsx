import { AgentCard } from "@/frontend/components/agent-setup/agent-card";
import { StepSheet } from "./step-sheet";
import { useReturn } from "./use-return";

/** Step 1: the setup card. "I'll do this later" skips it; Continue shows once the agent can teach. */
export function AgentStep({ ready, onNext }: { ready: boolean; onNext: () => void }) {
	useReturn(ready ? onNext : null);
	return (
		<StepSheet at={1} title="Your teacher" sub="godspeed teaches through Claude Code or Codex, on the plan you already have.">
			<AgentCard />
			<div className="flex items-center pt-2">
				{ready ? (
					<button type="button" data-testid="onboarding-agent-continue" className="lh-btn lh-btn-main ml-auto" onClick={onNext}>
						Continue
					</button>
				) : (
					<button type="button" data-testid="onboarding-later" className="lh-btn lh-btn-quiet" onClick={onNext}>
						I&apos;ll do this later
					</button>
				)}
			</div>
		</StepSheet>
	);
}
