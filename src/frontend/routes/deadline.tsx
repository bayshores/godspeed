import { data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { SpaceDeadline } from "@/shared/core";
import { DeadlinePage } from "@/frontend/components/deadline/deadline-page";
import { CheatSheetStudio } from "@/frontend/components/cheat-sheet/studio";
import { PageTitle } from "./page-title";

/** A deadline and its space, read before the page shows (GET /api/deadlines/[id]). */
export async function deadlineLoader({ params, request }: LoaderFunctionArgs) {
	const res = await fetch(`/api/deadlines/${encodeURIComponent(params.id ?? "")}`, { signal: request.signal });
	if (res.status === 404) throw data(null, { status: 404 });
	if (!res.ok) throw new Error(`GET /api/deadlines/${params.id}: ${res.status}`);
	return (await res.json()) as { spaceId: string; deadline: SpaceDeadline };
}

/** One deadline's page, from its ring on the Overview or its row in Coming up. */
export function DeadlineRoute() {
	const { spaceId, deadline } = useLoaderData<typeof deadlineLoader>();
	return (
		<>
			<PageTitle page={deadline.name || "Deadline"} />
			<DeadlinePage key={deadline.id} spaceId={spaceId} deadlineId={deadline.id} />
		</>
	);
}

/** A deadline's cheat sheet studio, from the Cheat sheet button on its page. */
export function CheatSheetRoute() {
	const { spaceId, deadline } = useLoaderData<typeof deadlineLoader>();
	return (
		<>
			<PageTitle page={`Cheat sheet for ${deadline.name}`} />
			<CheatSheetStudio key={deadline.id} spaceId={spaceId} deadlineId={deadline.id} deadlineName={deadline.name} />
		</>
	);
}
