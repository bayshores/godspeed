import { data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { MockView } from "@/shared/core";
import { MockPage } from "@/frontend/components/prep/mock-page";
import { PageTitle } from "./page-title";

/** A mock, read before the page shows (GET /api/spaces/[id]/mocks/[mockId]);
 *  any refusal means it isn't there. */
export async function mockLoader({ params, request }: LoaderFunctionArgs) {
	const res = await fetch(`/api/spaces/${encodeURIComponent(params.spaceId ?? "")}/mocks/${encodeURIComponent(params.mockId ?? "")}`, {
		signal: request.signal,
	});
	if (!res.ok) throw data(null, { status: 404 });
	return { spaceId: params.spaceId ?? "", mockId: params.mockId ?? "", view: (await res.json()) as MockView };
}

/** One mock: being written, taken against the clock, then its results. */
export function MockRoute() {
	const { spaceId, mockId, view } = useLoaderData<typeof mockLoader>();
	return (
		<>
			<PageTitle page={`Mock ${view.mock.n}`} />
			<MockPage key={mockId} spaceId={spaceId} mockId={mockId} />
		</>
	);
}
