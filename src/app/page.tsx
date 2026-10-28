import { HomePage } from "@/components/home-page/home-page";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

/** Home: what's coming up across every class, and one block per class. */
export default function Home() {
	return <HomePage />;
}
