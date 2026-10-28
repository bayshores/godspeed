import { Home } from "@/components/home";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

/** The new-lesson screen. */
export default function HomePage() {
	return <Home />;
}
