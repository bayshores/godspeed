import type { Metadata } from "next";
import { PrepStart } from "@/frontend/components/prep/prep-start";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Prepare" };

/** "Prepare for something" ("/prep"): where a prep starts. */
export default function PrepStartPage() {
	return <PrepStart />;
}
