import { useMemo } from "react";
import { Link } from "react-router";
import type { ProgressPayload, SpaceSummary } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { rowMotion } from "@/frontend/components/motion";
import { useListMotion, type Moves } from "@/frontend/components/presence";
import { spaceRow } from "./space-list-model";
import { Pane } from "@/frontend/components/ui/pane";
import { chip } from "@/frontend/components/ui/chip";

/**
 * "Your spaces": a tile per open space, named as its tab names it (its
 * color square, then its name), with its topics by status and a chip for
 * the new files its linked folder brought. What the teacher is doing is
 * the strip, so the tile never says it. The tile opens the space
 * as its tab does; the new-files chip opens its Files page. A closed
 * space's tile fades out in its place, with what it said; one new to the list steps in.
 */
export function SpaceList({
	spaces,
	progress,
	errors,
	newFiles,
	onOpen,
}: {
	spaces: readonly SpaceSummary[];
	progress: ReadonlyMap<string, ProgressPayload>;
	/** Why a space's progress failed to load. */
	errors: ReadonlyMap<string, string>;
	/** Each space's "2 new files since Monday". */
	newFiles: ReadonlyMap<string, string>;
	onOpen: (spaceId: string) => void;
}) {
	const tiles = useListMotion(
		useMemo(() => spaces.map((s) => ({ key: s.id, space: s, progress: progress.get(s.id), failed: errors.has(s.id), newFiles: newFiles.get(s.id) ?? null })), [spaces, progress, errors, newFiles]),
	);
	return (
		<Pane data-testid="today-spaces" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Your spaces</h2>
			</div>
			<ul className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[6px]">
				{tiles.map(({ item, ...moves }) => (
					<SpaceTile key={item.key} space={item.space} progress={item.progress} failed={item.failed} newFiles={item.newFiles} {...moves} onOpen={onOpen} />
				))}
			</ul>
		</Pane>
	);
}

function SpaceTile({
	space: s,
	progress,
	failed,
	newFiles,
	leaving,
	joined,
	onOpen,
}: Moves & {
	space: SpaceSummary;
	progress: ProgressPayload | undefined;
	failed: boolean;
	newFiles: string | null;
	onOpen: (spaceId: string) => void;
}) {
	const words = spaceRow(progress, failed);
	const total = words.segments.reduce((sum, seg) => sum + seg.count, 0);
	return (
		// The name's link covers the whole tile; the new-files chip sits above it.
		<li data-testid={`today-space-${s.id}`} {...rowMotion(leaving, joined, "relative flex min-w-0 flex-col gap-2 bg-tone px-3 py-2.5 text-item transition-colors hover:bg-tone-2")}>
			<span className="flex min-h-[26px] min-w-0 items-center gap-2">
				<span aria-hidden className="size-2.5 shrink-0" style={{ background: spaceColorVar(s.color) }} />
				<Link to="/space" data-testid="today-space-open" onClick={() => onOpen(s.id)} title={s.name} className="min-w-0 truncate text-ink after:absolute after:inset-0">
					{s.name}
				</Link>
				{newFiles && (
					<Link to="/space/files" data-testid="today-space-files" onClick={() => onOpen(s.id)} title={newFiles} className={cn(chip("lit", "tag"), "relative z-10 ml-auto max-w-[60%] shrink hover:underline")}>
						<PixelIcon name="folder" size={12} />
						<span className="truncate">{newFiles}</span>
					</Link>
				)}
			</span>
			{total > 0 && (
				<span role="img" aria-label={words.line} className="flex h-2 w-full gap-[2px]">
					{words.segments.map((seg) => (
						<span key={seg.key} className="h-full min-w-1" style={{ flexGrow: seg.count, background: seg.color }} />
					))}
				</span>
			)}
			{words.line && (
				<span data-testid="today-space-line" aria-hidden={total > 0 || undefined} className="text-ui leading-snug text-ink-2">
					{words.line}
				</span>
			)}
		</li>
	);
}
