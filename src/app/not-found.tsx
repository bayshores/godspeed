import Link from "next/link";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { cn } from "@/frontend/lib/utils";

/** A removed lesson's or deadline's link, in the app's own look (the
 *  default 404 page paints over the app's colors). */
export default function NotFound() {
	return (
		<div className="h-full overflow-y-auto">
			<div data-testid="not-found" className="mx-auto flex w-[520px] max-w-full flex-col gap-6 px-6 pt-[220px] pb-10">
				<h1 className="text-[30px] leading-tight text-ink">This page isn&apos;t here anymore.</h1>
				<p className="text-[17px] text-ink-2">It may have been removed.</p>
				<div>
					<Link href="/" className={cn("lh-btn lh-btn-main", BIG_BUTTON)}>
						Go to Today
					</Link>
				</div>
			</div>
		</div>
	);
}
