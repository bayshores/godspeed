import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { mockState } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { LoadFailed } from "@/frontend/components/load-failed";
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
export function MockPage({ spaceId, mockId }: { spaceId: string; mockId: string }) {
	const navigate = useNavigate();
	const { active, setActive } = useSpaces();
	const [joined, setJoined] = useState(active === spaceId);
	useEffect(() => {
		if (!joined) {
			if (active === spaceId) setJoined(true);
			else setActive(spaceId);
		} else if (active !== spaceId) navigate("/space", { replace: true });
	}, [active, spaceId, joined, setActive, navigate]);

	const { view, loadError, reload } = useMock(spaceId, mockId);
	if (!view) {
		return (
			<div className="flex h-full flex-col">
				{loadError ? <LoadFailed message="Couldn't load this mock." onRetry={() => void reload()} className="px-8 py-6" /> : <div className="flex-1" aria-hidden />}
			</div>
		);
	}
	const state = mockState(view.mock);
	return (
		<>
			{/* Stays in place across the screens, so a change is read out. */}
			<p role="status" className="sr-only">
				{mockAnnouncement(view.mock, state)}
			</p>
			{state === "running" || state === "paused" ? (
				<MockRun key={view.mock.id} view={view} />
			) : state === "graded" ? (
				<MockResults view={view} />
			) : (
				<div className="flex h-full flex-col">
					<MockBar view={view} />
					<MockWaiting view={view} state={state} />
				</div>
			)}
		</>
	);
}
