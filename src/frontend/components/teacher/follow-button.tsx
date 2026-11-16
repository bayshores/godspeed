import { followButtons } from "@/frontend/components/top-bar/top-bar-model";
import { cn } from "@/frontend/lib/utils";
import { useTeacher } from "./teacher-context";

/** A piece of the pill: the bar's ink, a shade over it on hover. */
const PIECE = "lh-press lh-no-drag flex self-stretch shrink-0 items-center px-2.5 text-[15px] whitespace-nowrap";
const QUIET = "bg-bar-ink/15 text-bar-ink hover:bg-bar-ink/25";
const LIT = "bg-highlight text-ink";

/**
 * Beside the pill while the teacher works: "Following" on the highlighter
 * (the window goes where the teacher works; a click stops it) or "Follow".
 * With Follow off, a fresh change on another page shows "Go to" its page.
 */
export function FollowButton() {
	const teacher = useTeacher();
	if (!teacher) return null;
	const { go, follow } = followButtons({ following: teacher.follow, working: !!teacher.doing?.working, offer: teacher.offer });
	const offer = teacher.offer;
	return (
		<>
			{go && offer && (
				<button type="button" data-testid="follow-go" title={offer.label} onClick={() => teacher.go(offer)} className={cn(PIECE, LIT)}>
					{go}
				</button>
			)}
			{follow && (
				<button
					type="button"
					data-testid={teacher.follow ? "follow-stop" : "follow-start"}
					aria-pressed={teacher.follow}
					onClick={() => teacher.setFollow(!teacher.follow)}
					className={cn(PIECE, teacher.follow ? LIT : QUIET)}
				>
					{follow}
				</button>
			)}
		</>
	);
}
