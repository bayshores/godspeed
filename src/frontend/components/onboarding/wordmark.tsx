import { TeacherSprite } from "@/frontend/components/halley/teacher-sprite";
import { cn } from "@/frontend/lib/utils";

/** The logo: the teacher mascot beside "godspeed". The welcome screen
 *  animates the two parts; the first-run intro shows it as it is. */
export function Wordmark({ markClassName, wordClassName }: { markClassName?: string; wordClassName?: string }) {
	return (
		<div className="relative flex items-center gap-[18px]">
			<TeacherSprite mood="idle" className={cn("w-[50px] shrink-0", markClassName)} />
			<h1 className={cn("text-[64px] leading-none text-ink", wordClassName)}>godspeed</h1>
		</div>
	);
}
