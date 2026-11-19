import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { MockView } from "@/shared/core";
import { MockPage } from "@/frontend/components/mock/mock-page";
import { mockUrl } from "@/frontend/components/mock/use-mock";
import { loadJson } from "./load-json";
import { PageTitle } from "./page-title";

/** A mock, read before the page shows (GET /api/spaces/[id]/mocks/[mockId]). */
export async function mockLoader({ params, request }: LoaderFunctionArgs) {
	const [spaceId, mockId] = [params.spaceId ?? "", params.mockId ?? ""];
	return { spaceId, mockId, view: await loadJson<MockView>(mockUrl(spaceId, mockId), request.signal) };
}

/** One mock: being written, taken against the clock, then its results. */
export function MockRoute() {
	const { spaceId, mockId, view } = useLoaderData<typeof mockLoader>();
	return (
		<>
			<PageTitle page={`Mock ${view.mock.n}`} />
			<MockPage key={mockId} spaceId={spaceId} mockId={mockId} initial={view} />
		</>
	);
}
