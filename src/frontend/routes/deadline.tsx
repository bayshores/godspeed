import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { SpaceDeadline } from "@/shared/core";
import { DeadlinePage } from "@/frontend/components/deadline/deadline-page";
import { takesMocks } from "@/frontend/components/deadline/mocks-model";
import { deadlineAboutUrl } from "@/frontend/components/deadline/use-deadline-about";
import { deadlineMocksUrl, type DeadlineMocksRead } from "@/frontend/components/deadline/use-deadline-mocks";
import { CheatSheetStudio } from "@/frontend/components/cheat-sheet/studio";
import { getJson } from "@/frontend/lib/api";
import { loadJson } from "./load-json";
import { PageTitle } from "./page-title";

/** A deadline and its space, read before the page shows (GET /api/deadlines/[id]). */
export async function deadlineLoader({ params, request }: LoaderFunctionArgs) {
	return loadJson<{ spaceId: string; deadline: SpaceDeadline }>(`/api/deadlines/${encodeURIComponent(params.id ?? "")}`, request.signal);
}

/** A deadline's page also reads a test's or an interview's mocks and what it's like, so the
 *  page opens with them drawn; a failed read (null) is left to the page. */
export async function deadlinePageLoader(args: LoaderFunctionArgs) {
	const { spaceId, deadline } = await deadlineLoader(args);
	const { signal } = args.request;
	const [mocks, about] = await Promise.all([
		takesMocks(deadline.kind) ? getJson<DeadlineMocksRead>(deadlineMocksUrl(spaceId, deadline.id), signal) : null,
		deadline.aboutFileId ? getJson<{ text: string }>(deadlineAboutUrl(spaceId, deadline.id), signal) : null,
	]);
	return { spaceId, deadline, mocks: mocks?.body ?? null, about: about?.body?.text ?? null };
}

/** One deadline's page, from its ring on the Overview or its row in Coming up. */
export function DeadlineRoute() {
	const { spaceId, deadline, mocks, about } = useLoaderData<typeof deadlinePageLoader>();
	return (
		<>
			<PageTitle page={deadline.name || "Deadline"} />
			<DeadlinePage key={deadline.id} spaceId={spaceId} deadlineId={deadline.id} initialMocks={mocks ?? undefined} initialAbout={about ?? undefined} />
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
