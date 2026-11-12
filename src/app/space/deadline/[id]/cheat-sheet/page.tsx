import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheatSheetStudio } from "@/frontend/components/cheat-sheet/studio";
import { deadlineWithSpace } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
	const { id } = await params;
	const owner = deadlineWithSpace(id);
	return { title: owner ? `Cheat sheet for ${owner.deadline.name}` : "Cheat sheet" };
}

/** A deadline's cheat sheet studio, from the Cheat sheet button on its page. */
export default async function CheatSheetPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const owner = deadlineWithSpace(id);
	if (!owner) notFound();
	return <CheatSheetStudio key={id} spaceId={owner.spaceId} deadlineId={id} deadlineName={owner.deadline.name} />;
}
