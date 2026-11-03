import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheatSheetStudio } from "@/components/cheat-sheet/studio";
import { deadlineWithClass } from "@/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
	const { id } = await params;
	const owner = deadlineWithClass(id);
	return { title: owner ? `Cheat sheet for ${owner.deadline.name}` : "Cheat sheet" };
}

/** A deadline's cheat sheet studio, from the Cheat sheet button on its page. */
export default async function CheatSheetPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const owner = deadlineWithClass(id);
	if (!owner) notFound();
	return <CheatSheetStudio key={id} classId={owner.classId} deadlineId={id} />;
}
