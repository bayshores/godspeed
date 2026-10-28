import { NewLesson } from "@/components/home";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

/** The new-lesson screen ("/new", Practice: "/new?mode=practice"). */
export default function NewLessonPage() {
	return <NewLesson />;
}
