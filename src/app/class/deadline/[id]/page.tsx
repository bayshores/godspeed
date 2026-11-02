import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeadlinePage } from "@/components/deadline/deadline-page";
import { getClass, listClasses } from "@/server";

export const dynamic = "force-dynamic";

/** Deadline ids are unique across classes, so a deadline finds its class. */
function deadlineOwner(id: string) {
	return listClasses().find((c) => getClass(c.id)?.deadlines?.some((d) => d.id === id));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
	const { id } = await params;
	const owner = deadlineOwner(id);
	return { title: (owner && getClass(owner.id)?.deadlines?.find((d) => d.id === id)?.name) || "Deadline" };
}

/** One deadline's page, from its ring on the Overview or its row in Coming up. */
export default async function ClassDeadlinePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const owner = deadlineOwner(id);
	if (!owner) notFound();
	return <DeadlinePage key={id} classId={owner.id} deadlineId={id} />;
}
