import { memo } from "react";
import { InfoIcon } from "lucide-react";
import type { ClassFile, FileCoverage } from "@/core";
import { Tip } from "@/components/ui/tooltip";
import { FileRow, type FileRowActions } from "./file-row";

/** The two sections' help tooltips. */
export const SECTION_HELP = {
	study: { title: "Study material", body: "Turned into facts for the graph. Course info is only read by the teacher." },
	info: { title: "Course info", body: "Syllabus, assignments and other class details. Only read by the teacher; never turned into facts." },
} as const;

/** "Study material · 6" / "Course info · 3" with its help icon, then the rows. */
export const FileSection = memo(function FileSection({
	kind,
	files,
	coverage,
	disabled,
	flashId,
	actions,
}: {
	kind: "study" | "info";
	files: readonly ClassFile[];
	coverage: ReadonlyMap<string, FileCoverage>;
	disabled?: boolean;
	flashId: string | null;
	actions: FileRowActions;
}) {
	const help = SECTION_HELP[kind];
	return (
		<section data-testid={`files-section-${kind}`} className="flex w-full flex-col gap-0.5">
			<div className="flex items-center gap-2 pb-2">
				<h2 className="text-[13px] font-bold text-ink-3">
					{help.title} · {files.length}
				</h2>
				<Tip title={help.title} body={<span className="text-xs text-ink-2">{help.body}</span>} side="bottom" align="start" className="w-[250px]">
					<button type="button" aria-label={`About ${help.title.toLowerCase()}`} className="text-ink-3 hover:text-ink-2">
						<InfoIcon className="size-[13px]" aria-hidden />
					</button>
				</Tip>
			</div>
			{files.length > 0 && (
				<ul className="flex flex-col gap-0.5">
					{files.map((file) => (
						<FileRow key={file.id} file={file} coverage={coverage.get(file.id)} disabled={disabled} flash={flashId === file.id} actions={actions} />
					))}
				</ul>
			)}
		</section>
	);
});
