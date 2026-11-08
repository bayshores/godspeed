import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeadlinePage } from "@/frontend/components/deadline/deadline-page";
import { deadlineWithClass } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
	const { id } = await params;
	return { title: (deadlineWithClass(id)?.deadline.name || "deadline").toLowerCase() };
}

/** One deadline's page, from its ring on the Overview or its row in Coming up. */
export default async function ClassDeadlinePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const owner = deadlineWithClass(id);
	if (!owner) notFound();
	return <DeadlinePage key={id} classId={owner.classId} deadlineId={id} />;
}
