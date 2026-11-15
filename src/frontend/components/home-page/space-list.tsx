import type { CSSProperties } from "react";
import { Link } from "react-router";
import type { ProgressPayload, SpaceSummary } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { todayWorkLine } from "@/frontend/components/work/work-model";
import { spaceRow } from "./space-list-model";
import { Pane } from "@/frontend/components/ui/pane";
import { CARD_HEAD, CARD_TITLE, CHIP } from "./styles";

/**
 * "Your spaces": a card with a row per open space with its topics by status, and
 * chips for what the teacher is doing with its files and for the new files
 * its linked folder brought. The row opens the space as its tab does; the
 * new-files chip opens its Files page.
 */
export function SpaceList({
	spaces,
	progress,
	errors,
	worker,
	newFiles,
	onOpen,
}: {
	spaces: readonly SpaceSummary[];
	progress: ReadonlyMap<string, ProgressPayload>;
	/** Why a space's progress failed to load. */
	errors: ReadonlyMap<string, string>;
	/** Who reads files (useWorker); null when no agent takes work. */
	worker: string | null;
	/** Each space's "2 new files since Monday". */
	newFiles: ReadonlyMap<string, string>;
	onOpen: (spaceId: string) => void;
}) {
	return (
		<Pane data-testid="today-spaces" className="@container">
			<div className={CARD_HEAD}>
				<h2 className={CARD_TITLE}>Your spaces</h2>
			</div>
			{/* Wide, the rows share two columns: the counts as wide as the longest, the names in the
			    rest. Narrower, each row puts its counts under its name: a plain column, as WebKit
			    sizes a wrapped row wrong inside a grid. */}
			<ul className="flex flex-col divide-y-2 divide-dotted divide-edge px-6 pb-2 @min-[812px]:grid @min-[812px]:grid-cols-[minmax(15rem,1fr)_minmax(0,auto)]">
				{spaces.map((s) => (
					<SpaceRow key={s.id} space={s} progress={progress.get(s.id)} failed={errors.has(s.id)} work={todayWorkLine(s, worker)} newFiles={newFiles.get(s.id) ?? null} onOpen={onOpen} />
				))}
			</ul>
		</Pane>
	);
}

/** A chip in a row gives way before the space's name does, down to a few letters (3rem). */
const SQUEEZED_CHIP = "min-w-12 shrink";

function SpaceRow({
	space: s,
	progress,
	failed,
	work,
	newFiles,
	onOpen,
}: {
	space: SpaceSummary;
	progress: ProgressPayload | undefined;
	failed: boolean;
	work: string | null;
	newFiles: string | null;
	onOpen: (spaceId: string) => void;
}) {
	const words = spaceRow(progress, failed);
	const total = words.segments.reduce((sum, seg) => sum + seg.count, 0);
	return (
		// The name's link covers the whole row; the new-files chip sits above it.
		<li
			data-testid={`today-space-${s.id}`}
			className="relative col-span-full flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 pr-1 pl-1 text-[15px] transition-colors hover:bg-tone @min-[812px]:grid @min-[812px]:grid-cols-subgrid"
		>
			<span className="flex min-w-0 flex-1 basis-[200px] flex-wrap items-center gap-x-2 gap-y-1 @min-[812px]:flex-nowrap">
				<span aria-hidden className="size-2.5 shrink-0" style={{ background: spaceColorVar(s.color) }} />
				<Link
					to="/space"
					data-testid="today-space-open"
					onClick={() => onOpen(s.id)}
					title={s.name}
					// Wide, the name only truncates past what the dot and its chips at their smallest leave.
					style={{ "--chips": [work, newFiles].filter(Boolean).length } as CSSProperties}
					className="min-w-0 truncate font-medium text-ink after:absolute after:inset-0 @min-[812px]:max-w-[calc(100%-1.125rem-var(--chips)*3.5rem)] @min-[812px]:shrink-0"
				>
					{s.name}
				</Link>
				{work && (
					<span data-testid="today-space-work" title={work} className={cn(CHIP, SQUEEZED_CHIP)}>
						<span className="truncate">{work}</span>
					</span>
				)}
				{newFiles && (
					<Link to="/space/files" data-testid="today-space-files" onClick={() => onOpen(s.id)} title={newFiles} className={cn(CHIP, SQUEEZED_CHIP, "relative z-10 hover:underline")}>
						<PixelIcon name="folder" className="h-[10px] shrink-0" />
						<span className="truncate">{newFiles}</span>
					</Link>
				)}
			</span>
			<span className="flex w-full min-w-0 items-center gap-3 @min-[812px]:w-auto">
				{total > 0 ? (
					<span role="img" aria-label={words.line} className="flex h-2 w-20 shrink-0 gap-[2px]">
						{words.segments.map((seg) => (
							<span key={seg.key} className="h-full min-w-1" style={{ flexGrow: seg.count, background: seg.color }} />
						))}
					</span>
				) : (
					<span aria-hidden className="h-2 w-20 shrink-0 bg-[radial-gradient(var(--color-ink-2)_1px,transparent_1px)] bg-[length:4px_4px]" />
				)}
				<span data-testid="today-space-line" aria-hidden={total > 0 || undefined} className="min-w-0 flex-1 leading-snug text-ink-2 @min-[812px]:truncate">
					{words.line}
				</span>
				<PixelIcon name="chevron" className="h-[11px] text-ink" />
			</span>
		</li>
	);
}
