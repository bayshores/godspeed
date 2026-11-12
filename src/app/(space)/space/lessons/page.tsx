import type { Metadata } from "next";
import { LessonsList } from "@/frontend/components/lessons/lessons-list";

export const metadata: Metadata = { title: "Lessons" };

/** The space's Lessons tab; with no space picked, the lessons that belong to none. */
export default function SpaceLessonsPage() {
	return (
		<div className="h-full overflow-y-auto">
			<h1 className="sr-only">Lessons</h1>
			<LessonsList />
		</div>
	);
}
