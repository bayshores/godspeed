import { HomePage } from "@/frontend/components/home-page/home-page";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

/** Home: what's coming up across every space, and one block per space. */
export default function Home() {
	return <HomePage />;
}
