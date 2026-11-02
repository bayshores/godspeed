import { notFound } from "next/navigation";
import { DeadlinePage } from "@/components/deadline/deadline-page";
import { getClass, listClasses } from "@/server";

export const dynamic = "force-dynamic";

/** One deadline's page, from its ring on the Overview or its row in Coming
 *  up. Deadline ids are unique across classes, so the page finds its class. */
export default async function ClassDeadlinePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const owner = listClasses().find((c) => getClass(c.id)?.deadlines?.some((d) => d.id === id));
	if (!owner) notFound();
	return <DeadlinePage key={id} classId={owner.id} deadlineId={id} />;
}
