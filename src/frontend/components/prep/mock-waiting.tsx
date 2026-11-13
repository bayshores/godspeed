import { useState } from "react";
import { useNavigate } from "react-router";
import { DEFAULT_TEACHER_NAME, type MockState, type MockView } from "@/shared/core";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { cn } from "@/frontend/lib/utils";
import { postMock, removeMock } from "./use-mock";

/**
 * A mock that isn't running or graded: the teacher is writing its
 * questions, it is ready to start, or the teacher is grading it. A request
 * that failed says why, with Try again.
 */
export function MockWaiting({ view, state }: { view: MockView; state: Exclude<MockState, "running" | "graded"> }) {
	const navigate = useNavigate();
	const teacher = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const [error, setError] = useState<string | null>(null);
	const { spaceId, mock } = view;
	const act = async (action: string) => setError((await postMock(spaceId, mock.id, { action })).error);
	const size = `${mock.format.questions} ${mock.format.questions === 1 ? "question" : "questions"} in ${mock.format.minutes} minutes`;

	let body;
	if (state === "ready") {
		body = (
			<>
				<p className="text-[28px] leading-tight text-ink">Mock {mock.n} is ready</p>
				<p className="max-w-[520px] text-lg leading-snug text-ink-2">
					{size}. The clock starts when you start and keeps running if you leave. {teacher} stays quiet until it ends, then grades everything.
				</p>
				<button type="button" data-testid="mock-start" onClick={() => void act("start")} className={cn("lh-btn lh-btn-main", BIG_BUTTON)}>
					Start the mock
				</button>
			</>
		);
	} else if (view.working) {
		body = (
			<>
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
							data-testid="mock-delete"
							onClick={() =>
								void removeMock(spaceId, mock.id).then((failed) => {
									if (failed) setError(failed);
									else navigate("/space", { replace: true });
								})
							}
							className="lh-btn text-[15px]"
						>
							Delete this mock
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
