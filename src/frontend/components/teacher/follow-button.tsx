import { followButtons } from "@/frontend/components/top-bar/top-bar-model";
import { cn } from "@/frontend/lib/utils";
import { useTeacher } from "./teacher-context";

const MARKED = "[--lh-key:var(--lh-highlight)] [--lh-key-hover:var(--lh-highlight)]";

/**
 * Beside what the teacher does (the panel's status chip, a lesson's
 * teacher column) while it works: "Follow" (the window goes where the
 * teacher works) or "Following" in highlighter. With Follow off, a fresh
 * change on another page shows "Go to" its page. `look`: the keys' size
 * where they sit.
 */
export function FollowButton({ look }: { look: string }) {
	const teacher = useTeacher();
	if (!teacher) return null;
	const { go, follow } = followButtons({ following: teacher.follow, working: !!teacher.doing?.working, offer: teacher.offer });
	const offer = teacher.offer;
	return (
		<>
			{go && offer && (
				<button type="button" data-testid="follow-go" title={offer.label} onClick={() => teacher.go(offer)} className={cn(look, MARKED)}>
					{go}
				</button>
			)}
			{follow && (
				<button
					type="button"
					data-testid={teacher.follow ? "follow-stop" : "follow-start"}
					aria-pressed={teacher.follow}
					onClick={() => teacher.setFollow(!teacher.follow)}
					className={cn(look, teacher.follow ? MARKED : "lh-btn-quiet")}
				>
					{follow}
				</button>
			)}
		</>
	);
}
