import { memo } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import type { FileCoverage } from "@/core";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { blockWeight, displayName, fileHref, isStudied } from "./overview-model";
import { CARD, CARD_TITLE } from "./styles";

/**
 * COVERAGE (Class Overview): one block per study file, its width by fact
 * count. A studied file is dark with a fill for the share of its facts
 * that came up in lessons; an unstudied file is white. Hover: the file,
 * a came-up/not-used bar and the count. Click: the file on the Files page.
 * Below: "Next up" — the earliest unstudied file — with "Learn this".
 */
export const CoverageCard = memo(function CoverageCard({
	files,
	nextUp,
	busy,
	onLearn,
}: {
	files: readonly FileCoverage[];
	nextUp: FileCoverage | null;
	busy: boolean;
	onLearn: (file: FileCoverage) => void;
}) {
	const studied = files.filter(isStudied).length;
	return (
		<section data-testid="overview-coverage" className={CARD}>
			<div className="flex w-full items-end justify-between">
				<h2 className={CARD_TITLE}>Coverage</h2>
				<div className="flex items-end gap-1.5">
					<span data-testid="coverage-studied" className="font-mono text-[22px] font-bold leading-none tabular-nums text-ink">
						{studied}
					</span>
					<span className="text-[13.5px] text-ink-3">of {files.length} files studied</span>
				</div>
			</div>
			<div className="flex w-full gap-0.5">
				{files.map((file, i) => (
					<CoverageBlock key={file.fileId} file={file} index={i} />
				))}
			</div>
			{nextUp && (
				<div data-testid="overview-next-up" className="flex w-full items-center gap-3 border-t border-tone pt-3">
					<span className="shrink-0 text-[13.5px] font-bold text-ink-3">Next up</span>
					<span className="min-w-0 shrink truncate text-[15.5px] font-bold text-ink">{displayName(nextUp.name)}</span>
					<span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-3">
						<span className="font-mono tabular-nums">{nextUp.facts}</span> facts · earliest gap
					</span>
					<button
						type="button"
						data-testid="overview-learn-this"
						disabled={busy}
						onClick={() => onLearn(nextUp)}
						className="lh-press flex shrink-0 items-center gap-1.5 bg-ink px-3.5 py-2 text-sm font-extrabold text-black hover:bg-white disabled:opacity-60"
					>
						Learn this
						<ArrowRightIcon className="size-3.5" aria-hidden />
					</button>
				</div>
			)}
		</section>
	);
});

const CoverageBlock = memo(function CoverageBlock({ file, index }: { file: FileCoverage; index: number }) {
	const studied = isStudied(file);
	const share = file.share ?? 0;
	const name = displayName(file.name);
	return (
		<Tip
			side="bottom"
			align="start"
			title={name}
			body={file.facts > 0 ? <CoverageTipBody file={file} /> : undefined}
			hint="Click to open the file"
		>
			<Link
				href={fileHref(file.fileId)}
				data-testid={`coverage-file-${file.fileId}`}
				data-studied={studied || undefined}
				aria-label={name}
				className="group @container flex min-w-1.5 flex-col gap-1.5 outline-none"
				style={{ flex: `${blockWeight(file)} 1 0` }}
			>
				<span
					className={cn(
						"relative flex h-[46px] w-full flex-col justify-end outline-offset-[-1px] group-hover:outline group-hover:outline-1 group-hover:outline-ink group-focus-visible:outline group-focus-visible:outline-1 group-focus-visible:outline-ink",
						studied ? "bg-tone-2" : "bg-ink",
					)}
				>
					{studied && <span data-testid="coverage-fill" className="w-full bg-ink-3" style={{ height: `${Math.round(share * 100)}%` }} />}
				</span>
				<span
					className={cn(
						// Shown only where the block is wide enough for it.
						"invisible overflow-hidden whitespace-nowrap font-mono text-xs tabular-nums @min-[20px]:visible",
						studied ? "text-ink-3" : "font-bold text-ink",
					)}
				>
					{index + 1}
				</span>
			</Link>
		</Tip>
	);
});

function CoverageTipBody({ file }: { file: FileCoverage }) {
	const share = file.share ?? 0;
	return (
		<>
			<span className="flex h-1.5 w-52 gap-0.5" aria-hidden>
				{share > 0 && <span className="h-full bg-ink-2" style={{ width: `${share * 100}%` }} />}
				{share < 1 && <span className="h-full flex-1 bg-tone-2" />}
			</span>
			<span className="text-xs text-ink-2">
				{file.inLessons} of {file.facts} facts came up in lessons
			</span>
		</>
	);
}
