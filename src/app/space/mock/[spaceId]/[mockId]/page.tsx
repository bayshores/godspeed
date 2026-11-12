import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MockPage } from "@/frontend/components/prep/mock-page";
import { mockView } from "@/backend/server";
import { isSpaceId, isMockId } from "@/shared/core";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ spaceId: string; mockId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
	const { spaceId, mockId } = await params;
	const found = isSpaceId(spaceId) && isMockId(mockId) ? mockView(spaceId, mockId) : null;
	return { title: found?.ok ? `Mock ${found.value.mock.n}` : "Mock" };
}

/** One mock: being written, taken against the clock, then its results. */
export default async function SpaceMockPage({ params }: Params) {
	const { spaceId, mockId } = await params;
	if (!isSpaceId(spaceId) || !isMockId(mockId) || !mockView(spaceId, mockId).ok) notFound();
	return <MockPage key={mockId} spaceId={spaceId} mockId={mockId} />;
}
