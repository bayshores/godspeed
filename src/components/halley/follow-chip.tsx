"use client";

/**
 * The top bar's Follow chip: white, "Following Halley" with
 * Stop, while Follow is on. After you go somewhere yourself it says
 * "Stopped following" for a moment. With Follow off, a fresh change on
 * another page shows with a "Go to" button. Renders nothing otherwise.
 */
import type { AgentAction } from "@/core";
import { cn } from "@/lib/utils";
import { pageName } from "./follow";
import { useHalley } from "./halley-provider";

export function FollowChip({ className }: { className?: string }) {
	const halley = useHalley();
	if (!halley) return null;
	return (
		<FollowChipView
			following={halley.follow}
			name={halley.name}
			notice={halley.notice}
			onStop={() => halley.setFollow(false)}
			offer={halley.offer}
			onGo={halley.go}
			className={className}
		/>
	);
}

export function FollowChipView({
	following,
	name,
	notice,
	onStop,
	offer,
	onGo,
	className,
}: {
	following: boolean;
	name: string;
	notice: string | null;
	onStop: () => void;
	offer: AgentAction | null;
	onGo: (action: AgentAction) => void;
	className?: string;
}) {
	if (following) {
		return (
			<span data-testid="follow-chip" className={cn("lh-pop flex h-[35px] shrink-0 items-center gap-2 bg-ink px-2.5 font-ui text-background", className)}>
				<span aria-hidden className="size-3.5 shrink-0 rounded-full bg-background" />
				<span className="whitespace-nowrap text-[13.5px] font-bold">Following {name}</span>
				<button type="button" data-testid="follow-stop" onClick={onStop} className="lh-press bg-background/[0.13] px-2 py-0.5 text-[13px] hover:bg-background/20">
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
	if (offer) {
		return (
			<span data-testid="follow-offer" className={cn("lh-pop flex h-[35px] min-w-0 items-center gap-2 bg-tone px-2.5 font-ui text-[13.5px] text-ink-2", className)}>
				<span className="min-w-0 truncate">{offer.label}</span>
				<button type="button" data-testid="follow-go" onClick={() => onGo(offer)} className="lh-press shrink-0 bg-ink px-2 py-0.5 text-[13px] font-bold whitespace-nowrap text-background">
					Go to {pageName(offer.page)}
				</button>
			</span>
		);
	}
	return null;
}
