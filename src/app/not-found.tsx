import Link from "next/link";
import { TopBar } from "@/frontend/components/top-bar";

/** A removed lesson's or deadline's link, in the app's own look (the
 *  default 404 page paints over the sidebar's colors). */
export default function NotFound() {
	return (
		<div className="flex h-full flex-col">
			<TopBar />
			<div data-testid="not-found" className="flex flex-col items-start gap-3 px-[52px] py-6">
				<p className="text-base text-ink-2">This page isn&apos;t here anymore. It may have been removed.</p>
				<Link href="/" className="lh-press bg-tone px-3.5 py-2 text-sm font-bold text-ink hover:bg-tone-2">
					Go Home
				</Link>
			</div>
		</div>
	);
}
