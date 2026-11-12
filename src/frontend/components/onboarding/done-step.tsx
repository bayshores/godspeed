import { useEffect } from "react";
import { useSound } from "@/frontend/components/sounds";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { useReturn } from "./use-return";

/** The last screen: "You’re all set." with a connected agent, "You’re
 *  almost set." without one. */
export function DoneStep({
	agent,
	onStart,
	onConnect,
	disabled,
	failed,
}: {
	/** The connected agent, or null when none is connected yet. */
	agent: { name?: string } | null;
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
	return (
		<div data-testid="onboarding-done" className="ob-step m-auto flex flex-col items-center gap-[30px] px-4 text-center">
			<span className="flex size-14 items-center justify-center rounded border-2 border-ink bg-ans-right text-background">
				<PixelIcon name="check" className="h-5" />
			</span>
			<div className="flex flex-col items-center gap-2.5">
				<h1 className="text-[40px] leading-tight text-ink">{agent ? "You’re all set." : "You’re almost set."}</h1>
				<p className="text-[17px] text-ink-2">
					{agent
						? `Ask ${agent.name?.trim() || "your agent"} to teach you anything, or type a topic in godspeed.`
						: "Teaching starts once an agent is connected."}
				</p>
				{failed && (
					<p role="alert" data-testid="onboarding-save-error" className="text-[15px] text-ans-wrong">
						Couldn&apos;t save your setup.
					</p>
				)}
			</div>
			<div className="flex items-center gap-2.5">
				{!agent && (
					<button type="button" data-testid="onboarding-connect" className={cn("lh-btn", BIG_BUTTON)} onClick={onConnect}>
						Start your agent
					</button>
				)}
				<button type="button" data-testid="onboarding-finish" disabled={disabled} className={cn("lh-btn lh-btn-main", BIG_BUTTON)} onClick={onStart}>
					{failed ? "Try again" : "Start learning"}
				</button>
			</div>
		</div>
	);
}
