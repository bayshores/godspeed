import { mockState, type MockView } from "@/shared/core";
import { LoadingBox } from "@/frontend/components/loading";
import { useJoinSpace } from "@/frontend/components/use-join-space";
import { LoadFailed } from "@/frontend/components/load-failed";
import { Travel } from "@/frontend/components/travel/travel";
import { MockBar } from "./mock-bar";
import { mockAnnouncement } from "./mock-model";
import { MockResults } from "./mock-results";
import { MockRun } from "./mock-run";
import { MockWaiting } from "./mock-waiting";
import { useMock } from "./use-mock";

/**
 * ONE MOCK, a page of its own under a dark bar. What it shows follows
 * where the mock is: the teacher writing it, ready to start, being
 * answered (or paused), the teacher grading it, then the results.
 */
/** `initial`: the mock as the route's loader read it. */
export function MockPage({ spaceId, mockId, initial }: { spaceId: string; mockId: string; initial: MockView }) {
	useJoinSpace(spaceId);

	const { view, loadError, reload } = useMock(spaceId, mockId, initial);
	if (!view) {
		return (
			<div className="flex h-full flex-col">
				{loadError ? <LoadFailed message="Couldn't load this mock." onRetry={() => void reload()} className="px-8 py-6" /> : <LoadingBox className="flex-1" />}
			</div>
		);
	}
	const state = mockState(view.mock);
	const run = state === "running" || state === "paused";
	// The mock's screens lie side by side in the order it goes through them.
	const screen = run ? 1 : state === "graded" ? 2 : 0;
	return (
		<>
			{/* Stays in place across the screens, so a change is read out. */}
			<p role="status" className="sr-only">
				{mockAnnouncement(view.mock, state)}
			</p>
			<Travel place={{ key: String(screen), depth: 0, column: screen }}>
				{run ? (
					<MockRun key={view.mock.id} view={view} />
				) : state === "graded" ? (
					<MockResults view={view} />
				) : (
					<div className="flex h-full flex-col">
						<MockBar view={view} />
						<MockWaiting view={view} state={state} />
					</div>
				)}
			</Travel>
		</>
	);
}
