import { useEffect, useState } from "react";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useSound } from "@/frontend/components/sounds";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { AgentNeed } from "./agent-need";
import { useReturn } from "./use-return";

/** The last screen: "You’re all set." with a connected agent, "You’re
 *  almost set." without one. */
export function DoneStep({
	connected,
	onStart,
	onConnect,
	disabled,
	failed,
}: {
	/** An agent is connected. */
	connected: boolean;
	onStart: () => void;
	/** Back to step 1, "Start your agent". */
	onConnect: () => void;
	disabled: boolean;
	/** Saving the finished onboarding failed. */
	failed: boolean;
}) {
	const play = useSound();
	useEffect(() => play("all-set"), [play]);
	useReturn(disabled ? null : onStart);
	const [screen, setScreen] = useState(false);
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	return (
		<div data-testid="onboarding-done" className="ob-step m-auto flex flex-col items-center gap-[30px] px-4 text-center">
			<span className="flex size-14 items-center justify-center rounded bg-ans-right text-background">
				<PixelIcon name="check" className="h-5" />
			</span>
			<div className="flex flex-col items-center gap-2.5">
				<h1 className="text-[40px] leading-tight text-ink">{connected ? "You’re all set." : "You’re almost set."}</h1>
				<p className="text-[17px] text-ink-2">
					{connected ? `Ask ${teacher} to teach you anything, or type a topic in godspeed.` : `Teaching starts once ${teacher} is on.`}
				</p>
				{failed && (
					<p role="alert" data-testid="onboarding-save-error" className="text-[15px] text-ans-wrong">
						Couldn&apos;t save your setup.
					</p>
				)}
			</div>
			<AgentNeed open={screen} onOpen={() => setScreen(true)} />
			<div className="flex items-center gap-2.5">
				{!connected && (
					<button type="button" data-testid="onboarding-connect" className={cn("lh-btn", BIG_BUTTON)} onClick={onConnect}>
						Turn on {teacher}
					</button>
				)}
				<button type="button" data-testid="onboarding-finish" disabled={disabled} className={cn("lh-btn lh-btn-main", BIG_BUTTON)} onClick={onStart}>
					{failed ? "Try again" : "Start learning"}
				</button>
			</div>
		</div>
	);
}
