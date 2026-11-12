import { cn } from "@/frontend/lib/utils";

/** The app's name, as the welcome screen and the first-run intro show it. */
export function Wordmark({ className }: { className?: string }) {
	return <h1 className={cn("relative text-[64px] leading-none text-ink", className)}>godspeed</h1>;
}
