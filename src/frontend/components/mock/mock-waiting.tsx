import { useState } from "react";
import { useNavigate } from "react-router";
import { DEFAULT_TEACHER_NAME, type MockState, type MockView } from "@/shared/core";
import { AgentCompact, useCompactShown } from "@/frontend/components/agent-setup/agent-card";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { useSpaceRecord } from "@/frontend/components/files/space-record";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { Key } from "@/frontend/components/ui/key";
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
	const compactShown = useCompactShown();
	// The request a key started; its key shows it works and the others wait.
	const [pending, setPending] = useState<"start" | "retry" | "remove" | null>(null);
	const { spaceId, mock } = view;
	const run = async (which: NonNullable<typeof pending>, request: () => Promise<string | null>) => {
		setPending(which);
		const failed = await request();
		setPending(null);
		setError(failed);
	};
	const act = (action: "start" | "retry") => run(action, async () => (await postMock(spaceId, mock.id, { action })).error);
	const remove = () =>
		run("remove", async () => {
			const failed = await removeMock(spaceId, mock.id);
			if (!failed) navigate(deadlineHref(view.deadlineId), { replace: true });
			return failed;
		});
	const size = formatLine(mock.format);
	// Its study files, to say why it was written from what it's like.
	const { record } = useSpaceRecord(state === "ready" && mock.fromAbout ? spaceId : null);
	const deadline = record?.deadlines?.find((d) => d.id === mock.deadlineId);
	const fromAbout = record && deadline ? fromAboutLine(record.files, deadline) : null;

	let body;
	if (state === "ready") {
		// The size already says when there is no time limit.
		const time = mock.format.minutes === undefined ? "" : "The time starts when you start and keeps running if you leave, unless you pause it. ";
		body = (
			<>
				<p className="text-[28px] leading-tight text-ink">Mock {mock.n} is ready</p>
				<p className="max-w-[520px] text-lg leading-snug text-ink-2">
					{size}. {time}{teacher} stays quiet until it ends, then grades everything.
				</p>
				{fromAbout && (
					<p data-testid="mock-from-about" className="max-w-[520px] text-[17px] leading-snug text-ink-2">
						{fromAbout}
					</p>
				)}
				<Key data-testid="mock-start" busy={pending === "start"} disabled={pending !== null} onClick={() => void act("start")} className={cn("lh-btn-main", BIG_BUTTON)}>
					Start the mock
				</Key>
			</>
		);
	} else if (view.working) {
		body = (
			<>
				<p className="flex items-center gap-3 text-[23px] leading-snug text-ink">
					<BrailleSpinner className="h-5" label={state === "writing" ? "Writing the mock" : "Grading the mock"} />
					{state === "writing" ? `${teacher} is writing Mock ${mock.n}` : `${teacher} is grading Mock ${mock.n}`}
				</p>
				<p className="text-[17px] text-ink-2">
					{state === "writing" ? `${size}. ` : endedByTime(mock) ? <span data-testid="mock-time-up">The time is up. </span> : ""}This takes a few minutes. You can leave this page and come back.
				</p>
			</>
		);
	} else {
		const removeKey = state === "writing" && (
			<Key data-testid="mock-remove" busy={pending === "remove"} disabled={pending !== null} onClick={() => void remove()} className="text-[15px]">
				Remove this mock
			</Key>
		);
		body = (
			<div role="alert" className="flex flex-col items-center gap-3.5">
				<p className="text-[23px] leading-snug text-ink">{state === "writing" ? "The mock wasn't written" : "The mock wasn't graded"}</p>
				{/* The agent can't run: the compact card says why with the key that fixes it, and Try again waits for it. */}
				{compactShown ? (
					<>
						<AgentCompact />
						{removeKey}
					</>
				) : (
					<>
						<p className="text-[17px] text-ink-2">{view.error ? `What went wrong: ${view.error}.` : "The request stopped before the answer came back."}</p>
						<div className="flex items-center gap-2.5">
							<Key data-testid="mock-retry" busy={pending === "retry"} disabled={pending !== null} onClick={() => void act("retry")} className="lh-btn-main">
								Try again
							</Key>
							{removeKey}
						</div>
					</>
				)}
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
