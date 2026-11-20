/**
 * FIRST-LAUNCH ONBOARDING. Rendered by src/frontend/routes/root.tsx INSTEAD of
 * the app frame while the server says it is needed:
 *
 *   intro → 1 Turn on your teacher → 2 Add your first space → You're all set
 *
 * The agent step opens the agent in the godspeed folder and follows it
 * live (src/frontend/components/agent-folder); "I'll do this later" skips
 * it. The space step is optional. Without an agent, the done step's
 * "Turn on Teacher" goes back to step 1, whose Continue then returns to
 * the done step. Finishing writes general.onboarded and re-reads
 * /api/boot, which then shows Home; if that save fails, the done step stays
 * with Try again.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useBoot } from "@/frontend/components/boot";
import { useSettings } from "@/frontend/components/settings-context";
import { showFocusRingAfterTab } from "@/frontend/components/focus-hygiene";
import { WELCOME_KEY } from "@/frontend/components/teacher/panel-auto-model";
import { writeStorage } from "@/frontend/lib/storage";
import { cn } from "@/frontend/lib/utils";
import { AgentStep } from "./agent-step";
import { SpaceStep } from "./space-step";
import { Constellation, type ConstellationMode } from "./constellation";
import { DoneStep } from "./done-step";
import { Intro } from "./intro";

type Step = "intro" | "agent" | "space" | "done";

export function Onboarding() {
	const navigate = useNavigate();
	const { refresh } = useBoot();
	const { patchGeneral } = useSettings();
	const [step, setStep] = useState<Step>("intro");
	// Return during the intro jumps its animation to the end (.ob-skip).
	const [introSkipped, setIntroSkipped] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const [spaceId, setSpaceId] = useState<string | null>(null);
	// The space step is behind us: "Turn on Teacher" on the done step comes back here, not to it again.
	const [spaceStepDone, setSpaceStepDone] = useState(false);
	// Saving "onboarded" failed: stay on the done step (leaving would show the intro again).
	const [saveFailed, setSaveFailed] = useState(false);
	const status = useAgentStatus();
	// The app shell's keyboard listener isn't mounted here yet.
	useEffect(() => showFocusRingAfterTab(document), []);

	const finish = useCallback(async () => {
		setSaveFailed(false);
		setLeaving(true);
		const failed = await patchGeneral({ onboarded: true, ...(spaceId ? { activeSpace: spaceId } : {}) });
		if (failed !== null) {
			setLeaving(false);
			setSaveFailed(true);
			return;
		}
		writeStorage(WELCOME_KEY, "1");
		await new Promise((r) => setTimeout(r, 600));
		navigate("/", { replace: true });
		void refresh();
	}, [spaceId, navigate, refresh, patchGeneral]);

	const sky: ConstellationMode = step === "intro" ? "intro" : leaving ? "gone" : step === "done" ? "bright" : "backdrop";

	return (
		<div
			data-testid="onboarding"
			className={cn("ob-root relative flex h-dvh w-full flex-col overflow-hidden bg-background", step === "intro" && introSkipped && "ob-skip")}
		>
			{/* The window-drag band (desktop shell): first in the DOM, see globals.css. */}
			<div aria-hidden className="lh-drag absolute inset-x-0 top-0 z-10 h-12" />
			<Constellation mode={sky} />
			<div className={cn("relative flex min-h-0 flex-1 overflow-y-auto", leaving && "ob-leave")}>
				{step === "intro" && <Intro skipped={introSkipped} onSkip={() => setIntroSkipped(true)} onDone={() => setStep("agent")} />}
				{step === "agent" && <AgentStep connected={!!status?.connected} onNext={() => setStep(spaceStepDone ? "done" : "space")} />}
				{step === "space" && (
					<SpaceStep
						onDone={(id) => {
							setSpaceId(id);
							setSpaceStepDone(true);
							setStep("done");
						}}
					/>
				)}
				{step === "done" && (
					<DoneStep
						connected={!!status?.connected}
						onStart={() => void finish()}
						onConnect={() => setStep("agent")}
						disabled={leaving}
						failed={saveFailed}
					/>
				)}
			</div>
		</div>
	);
}
