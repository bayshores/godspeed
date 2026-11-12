import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeadlinePage } from "@/frontend/components/deadline/deadline-page";
import { deadlineWithSpace } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
	const { id } = await params;
	return { title: deadlineWithSpace(id)?.deadline.name || "Deadline" };
}

/** One deadline's page, from its ring on the Overview or its row in Coming up. */
export default async function SpaceDeadlinePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const owner = deadlineWithSpace(id);
	if (!owner) notFound();
	return <DeadlinePage key={id} spaceId={owner.spaceId} deadlineId={id} />;
}
