"use client";

/**
 * FIRST-LAUNCH ONBOARDING. Rendered by src/app/layout.tsx INSTEAD of the
 * app shell while src/backend/server/onboarding.ts says it is needed:
 *
 *   intro → 1 Start your agent → 2 Add your first class → You're all set
 *
 * The agent step opens the agent in the godspeed folder and follows it
 * live (src/frontend/components/agent-folder); "I'll do this later" skips
 * it. The class step is optional. Without an agent, the done step's
 * "Start your agent" goes back to step 1, whose Continue then returns to
 * the done step. Finishing writes general.onboarded and re-renders the
 * layout, which then shows Home; if that save fails, the done step stays
 * with Try again.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { notifySettingsSaved } from "@/frontend/components/settings-signal";
import { showFocusRingAfterTab } from "@/frontend/components/focus-hygiene";
import { cn } from "@/frontend/lib/utils";
import { AgentStep } from "./agent-step";
import { ClassStep } from "./class-step";
import { Constellation, type ConstellationMode } from "./constellation";
import { DoneStep } from "./done-step";
import { Intro } from "./intro";

type Step = "intro" | "agent" | "class" | "done";

export function Onboarding() {
	const router = useRouter();
	const [step, setStep] = useState<Step>("intro");
	// Return during the intro jumps its animation to the end (.ob-skip).
	const [introSkipped, setIntroSkipped] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const [classId, setClassId] = useState<string | null>(null);
	// The class step is behind us: "Start your agent" on the done step comes back here, not to it again.
	const [classStepDone, setClassStepDone] = useState(false);
	// Saving "onboarded" failed: stay on the done step (leaving would show the intro again).
	const [saveFailed, setSaveFailed] = useState(false);
	const status = useAgentStatus();
	// The app shell's keyboard listener isn't mounted here yet.
	useEffect(() => showFocusRingAfterTab(document), []);

	const finish = useCallback(async () => {
		setSaveFailed(false);
		setLeaving(true);
		let saved = false;
		try {
			const read = await fetch("/api/settings", { cache: "no-store" });
			if (!read.ok) throw new Error(String(read.status));
			const current = (await read.json()) as { settings?: { general?: Record<string, unknown> } | null };
			const general = { ...(current.settings?.general ?? {}), onboarded: true, ...(classId ? { activeClass: classId } : {}) };
			const res = await fetch("/api/settings/general", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(general),
			});
			saved = res.ok;
		} catch {
			/* saved stays false */
		}
		if (!saved) {
			setLeaving(false);
			setSaveFailed(true);
			return;
		}
		notifySettingsSaved("general");
		await new Promise((r) => setTimeout(r, 600));
		router.replace("/");
		router.refresh();
	}, [classId, router]);

	const sky: ConstellationMode = step === "intro" ? "intro" : leaving ? "gone" : step === "done" ? "bright" : "backdrop";

	return (
		<div
			data-testid="onboarding"
			className={cn("ob-root relative flex h-dvh w-full flex-col overflow-hidden bg-background", step === "intro" && introSkipped && "ob-skip")}
		>
			{/* The window-drag band (Electron): first in the DOM, see globals.css. */}
			<div aria-hidden className="lh-drag absolute inset-x-0 top-0 z-10 h-12" />
			<Constellation mode={sky} />
			<div className={cn("relative flex min-h-0 flex-1 overflow-y-auto", leaving && "ob-leave")}>
				{step === "intro" && <Intro skipped={introSkipped} onSkip={() => setIntroSkipped(true)} onDone={() => setStep("agent")} />}
				{step === "agent" && <AgentStep connected={!!status?.connected} onNext={() => setStep(classStepDone ? "done" : "class")} />}
				{step === "class" && (
					<ClassStep
						onDone={(id) => {
							setClassId(id);
							setClassStepDone(true);
							setStep("done");
						}}
					/>
				)}
				{step === "done" && (
					<DoneStep
						agent={status?.connected ? { name: status.name } : null}
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
