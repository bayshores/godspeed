/**
 * The corner card for a space that looks to be missing a deadline ("Homework in CSE 21 this week?",
 * "Nothing coming up in CSE 29", "Is CSE 29 over?"). Its words come from the server. The main key
 * hands the teacher "Update {space}", or closes a space that looks over; the quiet key waves the gap
 * off so it is not asked again. Which page shows it is gap-card-model.ts.
 */

import type { SpaceGap } from "@/shared/core";
import { useLocation } from "react-router";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { useSpaces } from "@/frontend/components/space-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { updateLine } from "@/frontend/components/teacher/starter-model";
import { useCloseSpace } from "@/frontend/components/top-bar/use-close-space";
import { useAnswerGap } from "@/frontend/components/use-open-deadlines";

/** `onUpdate`: the learner handed the teacher the update, so the card leaves for this run of the window. */
export function GapCard({ gap, onUpdate }: { gap: SpaceGap; onUpdate: () => void }) {
	const { pathname } = useLocation();
	const { spaces, active } = useSpaces();
	const teacher = useTeacher();
	const closer = useCloseSpace();
	const answering = useAnswerGap(gap);
	const busy = answering.busy || closer.busy;
	const error = answering.error ?? closer.error;
	const update = () => {
		const name = spaces.find((s) => s.id === gap.spaceId)?.name;
		if (name) teacher?.ask(updateLine(name));
		onUpdate();
	};
	// Closing the space on screen goes to Home; from another page nothing moves.
	const onScreen = gap.spaceId === active && (pathname === "/space" || pathname.startsWith("/space/"));
	return (
		<NoticeCard
			data-testid="gap-notice"
			kind="quiet"
			title={gap.title}
			actions={
				<>
					{gap.close ? (
						<button type="button" data-testid="gap-notice-close-space" disabled={busy} onClick={() => void closer.close({ id: gap.spaceId }, onScreen)} className="lh-btn">
							Close space
						</button>
					) : (
						teacher?.canAsk && (
							<button type="button" data-testid="gap-notice-update" disabled={busy} onClick={update} className="lh-btn">
								Update
							</button>
						)
					)}
					<button type="button" data-testid="gap-notice-answer" disabled={busy} onClick={answering.answer} className="lh-btn">
						{gap.answer}
					</button>
				</>
			}
		>
			<NoticeText>{gap.line}</NoticeText>
			{error && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
		</NoticeCard>
	);
}
