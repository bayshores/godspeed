"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mockState } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { LoadFailed } from "@/frontend/components/load-failed";
import { MockBar } from "./mock-bar";
import { MockResults } from "./mock-results";
import { MockRun } from "./mock-run";
import { MockWaiting } from "./mock-waiting";
import { useMock } from "./use-mock";

/**
 * ONE MOCK, a page of its own under a dark bar. What it shows follows
 * where the mock is: the teacher writing it, ready to start, the timed
 * run, the teacher grading it, then the results.
 */
export function MockPage({ spaceId, mockId }: { spaceId: string; mockId: string }) {
	const router = useRouter();
	const { active, setActive } = useSpaces();
	const [joined, setJoined] = useState(active === spaceId);
	useEffect(() => {
		if (!joined) {
			if (active === spaceId) setJoined(true);
			else setActive(spaceId);
		} else if (active !== spaceId) router.replace("/space");
	}, [active, spaceId, joined, setActive, router]);

	const { view, loadError, reload } = useMock(spaceId, mockId);
	if (!view) {
		return (
			<div className="flex h-full flex-col">
				{loadError ? <LoadFailed message="Couldn't load this mock." onRetry={() => void reload()} className="px-8 py-6" /> : <div className="flex-1" aria-hidden />}
			</div>
		);
	}
	const state = mockState(view.mock);
	if (state === "running") return <MockRun key={view.mock.id} view={view} />;
	if (state === "graded") return <MockResults view={view} />;
	return (
		<div className="flex h-full flex-col">
			<MockBar prepName={view.prepName} n={view.mock.n} />
			<MockWaiting view={view} state={state} />
		</div>
	);
}
