import { Link } from "react-router";
import type { ProgressPayload, SpaceSummary } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { todayWorkLine } from "@/frontend/components/work/work-model";
import { spaceRow } from "./space-list-model";
import { SECTION_TITLE } from "./styles";

/**
 * "Your spaces": a row per open space with its topics by status, what the
 * teacher is doing with its files, and the new files its linked folder
 * brought. The row opens the space as its tab does; the new-files line
 * opens its Files page.
 */
export function SpaceList({
	spaces,
	progress,
	worker,
	newFiles,
	onOpen,
}: {
	spaces: readonly SpaceSummary[];
	progress: ReadonlyMap<string, ProgressPayload>;
	/** Who reads files (useWorker); null when no agent takes work. */
	worker: string | null;
	/** Each space's "2 new files since Monday". */
	newFiles: ReadonlyMap<string, string>;
	onOpen: (spaceId: string) => void;
}) {
	return (
		<section data-testid="today-spaces" className="flex flex-col gap-4">
			<h2 className={SECTION_TITLE}>Your spaces</h2>
			<ul className="flex flex-col gap-3">
				{spaces.map((s) => (
					<SpaceRow key={s.id} space={s} progress={progress.get(s.id)} work={todayWorkLine(s, worker)} newFiles={newFiles.get(s.id) ?? null} onOpen={onOpen} />
				))}
			</ul>
		</section>
	);
}

function SpaceRow({
	space: s,
	progress,
	work,
	newFiles,
	onOpen,
}: {
	space: SpaceSummary;
	progress: ProgressPayload | undefined;
	work: string | null;
	newFiles: string | null;
	onOpen: (spaceId: string) => void;
}) {
	const words = spaceRow(progress, work);
	const total = words.segments.reduce((sum, seg) => sum + seg.count, 0);
	return (
		<li data-testid={`today-space-${s.id}`}>
			<Pane className="overflow-hidden">
				<Link to="/space" data-testid="today-space-open" onClick={() => onOpen(s.id)} className="flex min-h-[68px] items-center gap-4 px-5 py-3 transition-colors hover:bg-tone">
					<span aria-hidden className="size-3.5 shrink-0" style={{ background: spaceColorVar(s.color) }} />
					<span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1.5">
						<span title={s.name} className="w-[200px] max-w-full truncate text-[20px] leading-tight text-ink">
							{s.name}
						</span>
						<span className="flex min-w-0 flex-1 basis-[300px] items-center gap-3">
							{total > 0 ? (
								<span role="img" aria-label={`Topics, ${words.line}`} className="flex h-2.5 w-[120px] shrink-0 gap-[2px]">
									{words.segments.map((seg) => (
										<span key={seg.key} className="h-full min-w-1" style={{ flexGrow: seg.count, background: seg.color }} />
									))}
								</span>
							) : (
								<span aria-hidden className="h-2.5 w-[120px] shrink-0 bg-[radial-gradient(var(--color-ink-2)_1px,transparent_1px)] bg-[length:4px_4px]" />
							)}
							<span data-testid="today-space-line" aria-hidden={total > 0 || undefined} title={words.line} className="min-w-0 truncate text-base text-ink-2">
								{words.line}
							</span>
						</span>
						{words.work && (
							<span data-testid="today-space-work" className="basis-full text-base text-ink">
								{words.work}
							</span>
						)}
					</span>
					<PixelIcon name="chevron" className="h-[15px] text-ink" />
				</Link>
				{newFiles && (
					<Link
						to="/space/files"
						data-testid="today-space-files"
						onClick={() => onOpen(s.id)}
						className="flex items-center gap-2.5 border-t-2 border-line py-2.5 pr-5 pl-[54px] text-base text-ink transition-colors hover:bg-tone"
					>
						<PixelIcon name="folder" />
						{newFiles}
					</Link>
				)}
			</Pane>
		</li>
	);
}
