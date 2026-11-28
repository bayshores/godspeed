/**
 * FIRST-LAUNCH ONBOARDING. Rendered by src/frontend/routes/root.tsx INSTEAD of
 * the app frame while the server says it is needed:
 *
 *   intro → 1 Your teacher → 2 Add your first space → You're all set
 *
 * The agent step is the setup card (src/frontend/components/agent-setup);
 * "I'll do this later" skips it. The space step is optional. While the agent
 * can't teach, the done step holds the setup card's compact form, whose key
 * fixes what stops it. Finishing writes general.onboarded and re-reads
 * /api/boot, which then shows Home; if that save fails, the done step stays
 * with Try again.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ready } from "@/frontend/components/agent-setup/agent-card-model";
import { useAgentSetup } from "@/frontend/components/agent-setup/agent-setup-context";
import { useBoot } from "@/frontend/components/boot";
import { prefersReducedMotion, usePresence } from "@/frontend/components/presence";
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
	// The step on screen: the one left fades out before the next rises in. A skipped intro has no
	// exit to play (.ob-skip stops every animation in it), so it goes at once.
	const [shown, setShown] = useState(step);
	const out = usePresence(shown === step, shown === "intro" && introSkipped ? 0 : undefined);
	if (shown !== step && !out.mounted) setShown(step);
	const stepLeaving = out.state === "closed";
	// While a step leaves, Return waits: the step going would act on it a second time (make the space again).
	useEffect(() => {
		if (!stepLeaving) return;
		const hold = (e: KeyboardEvent) => e.key === "Enter" && e.stopImmediatePropagation();
		window.addEventListener("keydown", hold, true);
		return () => window.removeEventListener("keydown", hold, true);
	}, [stepLeaving]);
	const [leaving, setLeaving] = useState(false);
	const [spaceId, setSpaceId] = useState<string | null>(null);
	// Saving "onboarded" failed: stay on the done step (leaving would show the intro again).
	const [saveFailed, setSaveFailed] = useState(false);
	const canTeach = ready(useAgentSetup().health);
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
		// The sky's flash plays out first; with reduced motion there is none to wait for.
		if (!prefersReducedMotion()) await new Promise((r) => setTimeout(r, 600));
		navigate("/", { replace: true });
		void refresh();
	}, [spaceId, navigate, refresh, patchGeneral]);

	const sky: ConstellationMode = step === "intro" ? "intro" : leaving ? "gone" : step === "done" ? "bright" : "backdrop";

	return (
		<div
			data-testid="onboarding"
			className={cn("ob-root relative flex h-dvh w-full flex-col overflow-hidden bg-background", shown === "intro" && introSkipped && "ob-skip")}
		>
			{/* The window-drag band (desktop shell): first in the DOM, see globals.css. */}
			<div aria-hidden className="lh-drag absolute inset-x-0 top-0 z-10 h-12" />
			<Constellation mode={sky} />
			<div
				data-state={out.state}
				inert={stepLeaving || undefined}
				className={cn("relative flex min-h-0 flex-1 overflow-y-auto", leaving && "ob-leave", stepLeaving && "lh-fade")}
			>
				{shown === "intro" && <Intro skipped={introSkipped} onSkip={() => setIntroSkipped(true)} onDone={() => setStep("agent")} />}
				{shown === "agent" && <AgentStep ready={canTeach} onNext={() => setStep("space")} />}
				{shown === "space" && (
					<SpaceStep
						onDone={(id) => {
							setSpaceId(id);
							setStep("done");
						}}
					/>
				)}
				{shown === "done" && (
					<DoneStep
						ready={canTeach}
						onStart={() => void finish()}
						disabled={leaving}
						failed={saveFailed}
					/>
				)}
			</div>
		</div>
	);
}
