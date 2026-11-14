import { useState } from "react";
import { useNavigate } from "react-router";
import { DEFAULT_TEACHER_NAME, type MockState, type MockView } from "@/shared/core";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { useSpaceRecord } from "@/frontend/components/files/space-files-api";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { cn } from "@/frontend/lib/utils";
import { endedByTime, formatLine, fromAboutLine } from "./mock-model";
import { postMock, removeMock } from "./use-mock";

/**
 * A mock that isn't being answered or graded: the teacher is writing its
 * questions, it is ready to start, or the teacher is grading it. A request
 * that failed says why, with Try again.
 */
export function MockWaiting({ view, state }: { view: MockView; state: Exclude<MockState, "running" | "paused" | "graded"> }) {
	const navigate = useNavigate();
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const [error, setError] = useState<string | null>(null);
	const { spaceId, mock } = view;
	const act = async (action: string) => setError((await postMock(spaceId, mock.id, { action })).error);
	const size = formatLine(mock.format);
	// Its study files, to say why it was written from what it's like.
	const { record } = useSpaceRecord(state === "ready" && mock.fromAbout ? spaceId : null);
	const deadline = record?.deadlines?.find((d) => d.id === mock.deadlineId);
	const fromAbout = record && deadline ? fromAboutLine(record.files, deadline) : null;

	let body;
	if (state === "ready") {
		const time =
			mock.format.minutes === undefined ? "There is no time limit." : "The time starts when you start and keeps running if you leave, unless you pause it.";
		body = (
			<>
				<p className="text-[28px] leading-tight text-ink">Mock {mock.n} is ready</p>
				<p className="max-w-[520px] text-lg leading-snug text-ink-2">
					{size}. {time} {teacher} stays quiet until it ends, then grades everything.
				</p>
				{fromAbout && (
					<p data-testid="mock-from-about" className="max-w-[520px] text-[17px] leading-snug text-ink-2">
						{fromAbout}
					</p>
				)}
				<button type="button" data-testid="mock-start" onClick={() => void act("start")} className={cn("lh-btn lh-btn-main", BIG_BUTTON)}>
					Start the mock
				</button>
			</>
		);
	} else if (view.working) {
		body = (
			<>
				{state === "grading" && endedByTime(mock) && (
					<p data-testid="mock-time-up" className="text-[17px] text-ink-2">
						The time is up, so Mock {mock.n} ended.
					</p>
				)}
				<p className="flex items-center gap-3 text-[23px] leading-snug text-ink">
					<BrailleSpinner className="h-5" label={state === "writing" ? "Writing the mock" : "Grading the mock"} />
					{state === "writing" ? `${teacher} is writing Mock ${mock.n}` : `${teacher} is grading Mock ${mock.n}`}
				</p>
				<p className="text-[17px] text-ink-2">{state === "writing" ? `${size}. ` : ""}This takes a few minutes. You can leave this page and come back.</p>
				<NoAgentLine />
			</>
		);
	} else {
		body = (
			<div role="alert" className="flex flex-col items-center gap-3.5">
				<p className="text-[23px] leading-snug text-ink">{state === "writing" ? "The mock wasn't written" : "The mock wasn't graded"}</p>
				<p className="text-[17px] text-ink-2">{view.error ? `What went wrong: ${view.error}.` : "The request stopped before the answer came back."}</p>
				<div className="flex items-center gap-2.5">
					<button type="button" data-testid="mock-retry" onClick={() => void act("retry")} className="lh-btn lh-btn-main text-[15px]">
						Try again
					</button>
					{state === "writing" && (
						<button
							type="button"
							data-testid="mock-remove"
							onClick={() =>
								void removeMock(spaceId, mock.id).then((failed) => {
									if (failed) setError(failed);
									else navigate(deadlineHref(view.deadlineId), { replace: true });
								})
							}
							className="lh-btn text-[15px]"
						>
							Remove this mock
						</button>
					)}
				</div>
				<NoAgentLine />
			</div>
		);
	}
	return (
		<div data-testid={`mock-${state}`} className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 overflow-y-auto p-8 text-center">
			{body}
			{error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}
