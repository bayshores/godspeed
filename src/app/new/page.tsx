import type { Metadata } from "next";
import { NewLesson } from "@/components/home";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Study" };

/** The start page ("/new"): every new lesson is a study session. */
export default function NewLessonPage() {
	return <NewLesson />;
}
