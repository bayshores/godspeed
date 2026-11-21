import type { ComponentProps } from "react";
import { Link } from "react-router";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { PATH_LINE } from "@/frontend/components/terminal/starter-model";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";

/** The ways to start a space, each a whole clickable block. */
type StartWay = "files" | "deadline" | "path" | "study";

interface Tile {
	way: StartWay;
	testid: string;
	icon: ComponentProps<typeof PixelIcon>["name"];
	title: string;
	line: string;
	/** A page to go to, or else what a click does. */
	to?: string;
	onClick?: () => void;
}

const TILE = "lh-press flex h-full w-full items-center bg-(--lh-well) text-left hover:bg-tone";

/** THE START CARD (Progress): a space with nothing in it yet offers every way to start, in place of the empty boxes. */
export function StartCard({ color, onAddDeadline }: { color: string; onAddDeadline: () => void }) {
	return (
		<Pane data-testid="space-start" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Start this space</h2>
			</div>
			<StartTiles ways={["files", "deadline", "path", "study"]} color={color} wide onAddDeadline={onAddDeadline} />
		</Pane>
	);
}

/**
 * THE WAYS TO START A SPACE (Progress): a tile for each of `ways` that works
 * now. Asking the teacher for a path needs a teacher the page can hand a
 * line to, so without one its tile is left out. `wide` is the card across
 * the page: two columns once they fit, each tile with its line. In the side
 * column a tile is its name alone, which is all that fits there.
 */
export function StartTiles({ ways, color, wide, onAddDeadline }: { ways: readonly StartWay[]; color: string; wide?: boolean; onAddDeadline: () => void }) {
	const teacher = useTeacher();
	const asking = teacher?.canAsk ? teacher : null;
	const tiles: Tile[] = [
		{ way: "files", testid: "space-start-files", icon: "folder", title: "Add files", line: "Notes, readings, recordings or a syllabus.", to: "/space/files" },
		{ way: "deadline", testid: "space-start-deadline", icon: "plus", title: "Add a deadline", line: "An exam, homework, quiz, project or interview.", onClick: onAddDeadline },
		...(asking
			? [{ way: "path" as const, testid: "space-start-path", icon: "pages" as const, title: `Ask ${asking.name} for a path`, line: "No syllabus? The topics toward your goal, in order.", onClick: () => asking.ask(PATH_LINE) }]
			: []),
		{ way: "study", testid: "space-start-study", icon: "pencil", title: "Study something new", line: "One lesson on any topic, right now.", to: "/new" },
	];
	return (
		<ul className={cn("grid gap-[6px]", wide && "@[900px]:grid-cols-2")}>
			{tiles
				.filter((t) => ways.includes(t.way))
				.map((t) => {
					const inside = (
						<>
							<span aria-hidden className={cn("flex shrink-0 items-center justify-center text-background", wide ? "size-10" : "size-7")} style={{ background: color }}>
								<PixelIcon name={t.icon} className={wide ? "h-[13px]" : "h-[11px]"} />
							</span>
							<span className="flex min-w-0 flex-col">
								<span className={cn("text-ink", wide ? "text-[19px]" : "text-[17px]")}>{t.title}</span>
								{wide && <span className="text-[17px] text-ink-2">{t.line}</span>}
							</span>
							{wide && <PixelIcon name="chevron" className="ml-auto shrink-0 text-ink-2" />}
						</>
					);
					return (
						<li key={t.way}>
							{t.to ? (
								<Link to={t.to} data-testid={t.testid} className={cn(TILE, wide ? "gap-4 p-4" : "gap-3 px-3 py-2.5")}>
									{inside}
								</Link>
							) : (
								<button type="button" data-testid={t.testid} onClick={t.onClick} className={cn(TILE, wide ? "gap-4 p-4" : "gap-3 px-3 py-2.5")}>
									{inside}
								</button>
							)}
						</li>
					);
				})}
		</ul>
	);
}
