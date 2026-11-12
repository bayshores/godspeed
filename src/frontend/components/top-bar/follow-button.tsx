import { useHalley } from "@/frontend/components/halley/halley-provider";
import { cn } from "@/frontend/lib/utils";
import { followButtons } from "./top-bar-model";

/** The button on the dark top bar, and on a paper sheet. */
const TONE = {
	bar: { button: "lh-press shrink-0 self-center rounded-[2px] px-2.5 py-1 text-sm whitespace-nowrap", plain: "text-bar-ink hover:bg-bar-ink/10", marked: "bg-highlight font-medium text-ink" },
	sheet: { button: "lh-btn shrink-0", plain: "lh-btn-quiet", marked: "bg-highlight" },
};

/**
 * Beside the teacher chip while the teacher works: "Follow" (the window
 * goes where the teacher works) or "Following" in highlighter. With Follow
 * off, a fresh change on another page shows "Go to" its page.
 */
export function FollowButton({ tone = "bar" }: { tone?: keyof typeof TONE }) {
	const { button, plain, marked } = TONE[tone];
	const halley = useHalley();
	if (!halley) return null;
	const { go, follow } = followButtons({ following: halley.follow, working: !!halley.doing?.working, offer: halley.offer });
	const offer = halley.offer;
	return (
		<>
			{go && offer && (
				<button type="button" data-testid="follow-go" title={offer.label} onClick={() => halley.go(offer)} className={cn(button, marked)}>
					{go}
				</button>
			)}
			{follow && (
				<button
					type="button"
					data-testid={halley.follow ? "follow-stop" : "follow-start"}
					aria-pressed={halley.follow}
					onClick={() => halley.setFollow(!halley.follow)}
					className={cn(button, halley.follow ? marked : plain)}
				>
					{follow}
				</button>
			)}
		</>
	);
}
