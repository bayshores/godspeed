import { useRef, useState } from "react";
import { paleSpaceColor } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { TeacherActivity } from "@/frontend/components/teacher/teacher-activity";
import { TeacherHead } from "@/frontend/components/teacher/teacher-head";
import { FollowButton } from "@/frontend/components/top-bar/follow-button";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { ResizeHandle } from "@/frontend/components/ui/resize-handle";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { YourTurn, type YourTurnProps } from "./your-turn";

/** The column's width beside the reading sheet (drag its border line). */
export const COLUMN_WIDTH = { initial: 480, min: 340, max: 720 };

/**
 * THE TEACHER COLUMN, the lesson's right side (below the text in a narrow
 * window): the teacher's head (what it is doing, Follow, Activity), then
 * "Your turn" with the one writing box. "Activity" swaps the column for
 * the teacher's activity list until "Back to your turn".
 */
export function TeacherColumn({
	spaceId,
	width,
	onWidth,
	requiresReveal,
	onReveal,
	noAgent,
	...turn
}: YourTurnProps & {
	spaceId: string | undefined;
	/** The saved width; the lesson's layout sizes the column from it. */
	width: number;
	onWidth: (width: number) => void;
	/** A teach-phase check: it waits behind "Check your understanding". */
	requiresReveal: boolean;
	/** The learner opens the check. */
	onReveal: () => void;
	/** No agent is teaching (agent-status.tsx lessonAgentWaiting). */
	noAgent: boolean;
}) {
	const { pending, busy } = turn;
	const teacher = useTeacher();
	const name = teacher?.name ?? DEFAULT_TEACHER_NAME;
	const color = useSpaceColor(spaceId);
	const [activityOpen, setActivityOpen] = useState(false);

	// The reveal: false until the learner opens the check. Reset during
	// render when a new question lands, and open at once only when it
	// follows another of the teacher's questions (the reading already
	// happened; a question from earlier fills the wait before it).
	const pendingId = pending?.toolCallId ?? null;
	const [revealed, setRevealed] = useState(false);
	const prevPendingIdRef = useRef(pendingId);
	const prevFromEarlierRef = useRef(false);
	if (pendingId !== prevPendingIdRef.current) {
		const wasQuestion = prevPendingIdRef.current !== null && !prevFromEarlierRef.current;
		prevPendingIdRef.current = pendingId;
		if (pendingId && requiresReveal) setRevealed(wasQuestion);
	}
	prevFromEarlierRef.current = pending?.appPosed?.kind === "review";

	// With no agent teaching, the head says so.
	const doing = noAgent ? "Waiting for your agent" : busy ? `${name} is writing…` : teacher?.doing?.working ? teacher.doing.text : null;
	return (
		<aside
			data-testid="teacher-column"
			aria-label={name}
			className="relative flex min-h-0 min-w-0 flex-col [grid-area:teacher]"
			style={{ "--lh-pale": color ? paleSpaceColor(color) : "var(--color-tone)" } as React.CSSProperties}
		>
			{/* Side by side only: stacked, the column is full width. */}
			<div className="lh-teacher-resize">
				<ResizeHandle paneKey="your-turn" width={width} bounds={COLUMN_WIDTH} onWidth={onWidth} label="Resize the teacher column" />
			</div>
			<Pane className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<TeacherHead name={name} color={color} doing={doing}>
					<FollowButton tone="sheet" />
					{activityOpen ? (
						<button type="button" data-testid="teacher-activity-back" onClick={() => setActivityOpen(false)} className="lh-btn shrink-0">
							<PixelIcon name="chevron" className="-scale-x-100" />
							Back to your turn
						</button>
					) : (
						<button type="button" data-testid="teacher-activity-open" onClick={() => setActivityOpen(true)} className="lh-btn lh-btn-quiet shrink-0">
							Activity
						</button>
					)}
				</TeacherHead>
				{activityOpen ? (
					<div data-testid="teacher-activity" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[22px] pt-[18px] pb-[22px]">
						<h2 className="text-[22px] leading-tight font-medium text-ink">Activity</h2>
						<TeacherActivity />
					</div>
				) : (
					<YourTurn
						{...turn}
						revealPending={pending !== null && requiresReveal && !revealed}
						onReveal={() => {
							onReveal();
							setRevealed(true);
						}}
					/>
				)}
			</Pane>
		</aside>
	);
}
