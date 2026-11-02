"use client";

/**
 * The top bar's Follow chip, the one Follow control. While an agent is
 * connected:
 *  - Following: dark, "Following Halley", what it's doing right now
 *    ("Reading 06_Counting.pdf  3 of 12"), and Stop.
 *  - Not following: a quiet "Follow Halley" button, and a fresh change on
 *    another page with its "Go to" button.
 * The dot breathes while the agent works. A new line lifts the old one
 * out; the chip eases to its new width, so what follows it in the bar
 * glides instead of jumping. Screen readers hear the line, at most every
 * few seconds.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentAction } from "@/core";
import { cn } from "@/lib/utils";
import { pageName } from "./follow";
import { announceDelay, type AgentDoing } from "./follow-status";
import { useHalley } from "./halley-provider";

export function FollowChip({ className }: { className?: string }) {
	const halley = useHalley();
	if (!halley?.doing) return null;
	return (
		<FollowChipView
			following={halley.follow}
			name={halley.name}
			doing={halley.doing}
			onFollow={halley.setFollow}
			offer={halley.offer}
			onGo={halley.go}
			className={className}
		/>
	);
}

export function FollowChipView({
	following,
	name,
	doing,
	onFollow,
	offer,
	onGo,
	className,
}: {
	following: boolean;
	name: string;
	doing: AgentDoing;
	onFollow: (on: boolean) => void;
	offer: AgentAction | null;
	onGo: (action: AgentAction) => void;
	className?: string;
}) {
	const innerRef = useRef<HTMLSpanElement>(null);
	const width = useContentWidth(innerRef);
	const said = useAnnounced(doing.text);
	// The first look appears with the chip; a switch between the two rises in.
	const [mode, setMode] = useState({ following, switched: false });
	if (mode.following !== following) setMode({ following, switched: true });
	const switched = mode.switched;
	return (
		<span
			data-testid={following ? "follow-chip" : "follow-off"}
			className={cn(
				"lh-pop lh-ease-width relative flex h-[35px] shrink-0 overflow-clip font-ui text-[13.5px]",
				following ? "bg-ink text-background" : "text-ink-2",
				className,
			)}
			// The focus ring sits 4px outside a button.
			style={{ width: width ?? undefined, overflowClipMargin: 4 }}
		>
			<span ref={innerRef} key={following ? "on" : "off"} className={cn("flex h-full w-max shrink-0 items-center", switched && "lh-swap-in")}>
				{following ? (
					<>
						<Dot working={doing.working} className="ml-2.5 bg-background" />
						<span className="ml-2 font-bold whitespace-nowrap">Following {name}</span>
						<span aria-hidden className="mx-2.5 h-3.5 w-px bg-background/25" />
						<span data-testid="follow-doing" className="flex items-baseline gap-2 text-background/75">
							<Swap text={doing.text} className="max-w-[min(300px,26vw)]" />
							{doing.count && <span className="font-mono text-[12.5px] text-background/55 tabular-nums">{doing.count}</span>}
						</span>
						{/* Room for Stop, which rides the chip's right edge as it eases. */}
						<span aria-hidden className="w-[62px] shrink-0" />
					</>
				) : (
					<>
						<button
							type="button"
							data-testid="follow-start"
							onClick={() => onFollow(true)}
							className="lh-press flex h-full items-center gap-2 px-2.5 font-bold whitespace-nowrap hover:bg-tone hover:text-ink"
						>
							<Dot working={doing.working} className="border border-current" />
							Follow {name}
						</button>
						{offer && (
							<span data-testid="follow-offer" className="ml-1 flex h-full items-center gap-2 bg-tone pr-1 pl-2.5">
								<Swap text={offer.label} className="max-w-[min(260px,22vw)]" />
								<button
									type="button"
									data-testid="follow-go"
									onClick={() => onGo(offer)}
									className="lh-press shrink-0 bg-ink px-2 py-0.5 text-[13px] font-bold whitespace-nowrap text-background hover:bg-ink-max"
								>
									Go to {pageName(offer.page)}
								</button>
							</span>
						)}
					</>
				)}
			</span>
			{following && (
				<button
					type="button"
					data-testid="follow-stop"
					aria-label={`Stop following ${name}`}
					onClick={() => onFollow(false)}
					className="lh-press absolute top-1/2 right-1.5 -translate-y-1/2 bg-background/[0.13] px-2 py-0.5 text-[13px] hover:bg-background/20"
				>
					Stop
				</button>
			)}
			<span aria-live="polite" className="sr-only">
				{`${name}: ${said}`}
			</span>
		</span>
	);
}

/** A small square: hollow or filled by the caller, breathing while busy. */
function Dot({ working, className }: { working: boolean; className: string }) {
	return <span aria-hidden data-working={working || undefined} className={cn("size-2 shrink-0", working && "lh-breathe", className)} />;
}

/** One line of text that, when it changes, lifts the old line out and
 *  raises the new one in its place. */
function Swap({ text, className }: { text: string; className?: string }) {
	const [line, setLine] = useState<{ text: string; gone: string | null; n: number }>({ text, gone: null, n: 0 });
	// A new text is kept with the one it replaces, for the exit.
	if (line.text !== text) setLine({ text, gone: line.text, n: line.n + 1 });
	useEffect(() => {
		if (line.gone === null) return;
		const t = setTimeout(() => setLine((l) => (l.n === line.n ? { ...l, gone: null } : l)), 160);
		return () => clearTimeout(t);
	}, [line.n, line.gone]);
	return (
		<span className={cn("relative block min-w-0", className)}>
			{line.gone !== null && (
				<span key={`out-${line.n}`} aria-hidden className="lh-swap-out absolute inset-x-0 top-0 truncate">
					{line.gone}
				</span>
			)}
			<span key={`in-${line.n}`} className={cn("block truncate", line.n > 0 && "lh-swap-in")}>
				{line.text}
			</span>
		</span>
	);
}

/** The content's natural width, kept current, for the chip to ease to. */
function useContentWidth(ref: React.RefObject<HTMLElement | null>): number | null {
	const [width, setWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => setWidth(el.offsetWidth);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});
	return width;
}

/** The line a screen reader hears: the newest one, at most every few
 *  seconds (a file read in parts would otherwise speak every part). */
function useAnnounced(text: string): string {
	const [said, setSaid] = useState(text);
	const lastAt = useRef<number | null>(null);
	useEffect(() => {
		if (text === said) return;
		const t = setTimeout(() => {
			lastAt.current = Date.now();
			setSaid(text);
		}, announceDelay(lastAt.current, Date.now()));
		return () => clearTimeout(t);
	}, [text, said]);
	return said;
}
