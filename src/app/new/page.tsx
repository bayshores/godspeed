import type { Metadata } from "next";
import { NewLesson } from "@/components/home";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New lesson" };

/** The new-lesson screen ("/new", Practice: "/new?mode=practice"). */
export default function NewLessonPage() {
	return <NewLesson />;
}
