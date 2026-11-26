import { useEffect } from "react";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { AgentCompact } from "@/frontend/components/agent-setup/agent-card";
import { useSound } from "@/frontend/components/sounds";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { useReturn } from "./use-return";

/** The last screen: "You’re all set." once the agent can teach, "You’re
 *  almost set." before, with what stops the agent and the key that fixes it
 *  (the setup card's compact form). */
export function DoneStep({
	ready,
	onStart,
	disabled,
	failed,
}: {
	/** The agent can teach. */
	ready: boolean;
	onStart: () => void;
	disabled: boolean;
	/** Saving the finished onboarding failed. */
	failed: boolean;
}) {
	const play = useSound();
	useEffect(() => play("all-set"), [play]);
	// While the agent can't teach, Return belongs to the compact card's code field.
	useReturn(disabled || !ready ? null : onStart);
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	return (
		<div data-testid="onboarding-done" className="ob-step m-auto flex flex-col items-center gap-[30px] px-4 text-center">
			<span className="flex size-14 items-center justify-center rounded bg-ans-right text-background">
				<PixelIcon name="check" className="h-5" />
			</span>
			<div className="flex flex-col items-center gap-2.5">
				<h1 className="text-[40px] leading-tight text-ink">{ready ? "You’re all set." : "You’re almost set."}</h1>
				{ready ? (
					<p className="text-[17px] text-ink-2">Ask {teacher} to teach you anything, or type a topic in godspeed.</p>
				) : (
					<AgentCompact className="w-full max-w-[460px] text-left" />
				)}
				{failed && (
					<p role="alert" data-testid="onboarding-save-error" className="text-[15px] text-ans-wrong">
						Couldn&apos;t save your setup.
					</p>
				)}
			</div>
			<button type="button" data-testid="onboarding-finish" disabled={disabled} className={cn("lh-btn lh-btn-main", BIG_BUTTON)} onClick={onStart}>
				{failed ? "Try again" : "Start learning"}
			</button>
		</div>
	);
}
