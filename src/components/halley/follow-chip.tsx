"use client";

/**
 * The top bar's Follow chip: white, "Following Halley" with
 * Stop, while Follow is on. After you go somewhere yourself it says
 * "Stopped following" for a moment. Renders nothing otherwise.
 */
import { cn } from "@/lib/utils";
import { useHalley } from "./halley-provider";

export function FollowChip({ className }: { className?: string }) {
	const halley = useHalley();
	if (!halley) return null;
	return <FollowChipView following={halley.follow} name={halley.name} notice={halley.notice} onStop={() => halley.setFollow(false)} className={className} />;
}

export function FollowChipView({
	following,
	name,
	notice,
	onStop,
	className,
}: {
	following: boolean;
	name: string;
	notice: string | null;
	onStop: () => void;
	className?: string;
}) {
	if (following) {
		return (
			<span data-testid="follow-chip" className={cn("lh-pop flex h-[35px] shrink-0 items-center gap-2 bg-ink px-2.5 font-ui text-black", className)}>
				<span aria-hidden className="size-3.5 shrink-0 rounded-full bg-black" />
				<span className="whitespace-nowrap text-[13.5px] font-bold">Following {name}</span>
				<button type="button" data-testid="follow-stop" onClick={onStop} className="lh-press bg-black/[0.13] px-2 py-0.5 text-[13px] hover:bg-black/20">
					Stop
				</button>
			</span>
		);
	}
	if (notice) {
		return (
			<span data-testid="follow-notice" role="status" className={cn("lh-pop flex h-[35px] shrink-0 items-center bg-tone px-2.5 font-ui text-[13.5px] text-ink-2", className)}>
				{notice}
			</span>
		);
	}
	return null;
}
