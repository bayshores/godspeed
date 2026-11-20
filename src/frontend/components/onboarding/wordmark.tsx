import { cn } from "@/frontend/lib/utils";

/** The logo: the app's icon, the app's name and a red seal dot.
 *  The welcome screen and the first-run intro show it. */
export function Wordmark({ className }: { className?: string }) {
	return (
		<div className={cn("relative flex items-end gap-[18px]", className)}>
			<img aria-hidden alt="" src="/app-icons/graphite.svg" className="size-[66px] shrink-0" />
			<h1 className="font-count text-[64px] leading-none font-normal text-ink">godspeed</h1>
			<span aria-hidden className="mb-[52px] -ml-2 size-2 shrink-0 bg-stamp" />
		</div>
	);
}
