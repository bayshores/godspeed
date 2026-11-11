import type { Metadata } from "next";
import { LessonsList } from "@/frontend/components/lessons/lessons-list";

export const metadata: Metadata = { title: "Lessons" };

/** The class's Lessons tab; with no class picked, the lessons that belong to none. */
export default function ClassLessonsPage() {
	return (
		<div className="h-full overflow-y-auto">
			<h1 className="sr-only">Lessons</h1>
			<LessonsList />
		</div>
	);
}
