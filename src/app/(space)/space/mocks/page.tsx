import type { Metadata } from "next";
import { PrepMocksTab } from "@/frontend/components/prep/prep-mocks";

export const metadata: Metadata = { title: "Mocks" };

/** A prep's Mocks tab. */
export default function SpaceMocksPage() {
	return (
		<div className="h-full overflow-y-auto">
			<h1 className="sr-only">Mocks</h1>
			<PrepMocksTab />
		</div>
	);
}
