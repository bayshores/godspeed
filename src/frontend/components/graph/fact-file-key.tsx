/**
 * Where a fact came from, as one key named after it: a space file's key
 * opens a PDF and shows any other file in the computer's file browser; a
 * lesson's key opens the lesson. A file that is not on this computer says
 * so under its key.
 */
import { Link } from "react-router";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { fileBrowserName } from "@/frontend/components/files/files-model";
import { useFactFile } from "./use-fact-file.ts";

const KEY = "lh-btn lh-btn-small lh-btn-quiet min-w-0 max-w-[34ch]";

/** `file` is the source's file path, `lesson` the lesson's title; neither while the graph loads. */
export function FactFileKey({ born, file, lesson }: { born: string | null; file: string | undefined; lesson: string | undefined }) {
	const onDisk = useFactFile(born);
	if (!born) return null;
	if (file) {
		if (!onDisk) return null;
		const name = file.split(/[\\/]/).pop()!;
		return (
			<div data-testid="fact-source" className="flex min-w-0 flex-col items-end gap-1.5">
				<button
					type="button"
					data-testid="fact-source-open"
					title={onDisk.opens ? `Open ${name}` : `Show ${name} in ${fileBrowserName(window.lh?.platform)}`}
					onClick={() => onDisk.show(onDisk.opens ? "open" : "folder")}
					className={KEY}
				>
					<PixelIcon name={onDisk.opens ? "pages" : "folder"} size={13} />
					<span className="truncate">{name}</span>
				</button>
				{onDisk.error && (
					<p role="alert" data-testid="fact-source-error" className="text-right text-sm text-ans-wrong">
						{onDisk.error}
					</p>
				)}
			</div>
		);
	}
	if (!lesson) return null;
	return (
		<div data-testid="fact-source" className="flex min-w-0">
			<Link to={`/chat/${born}`} data-testid="fact-source-open" title={`Open the lesson ${lesson}`} className={KEY}>
				<PixelIcon name="pencil-small" />
				<span className="truncate">{lesson}</span>
			</Link>
		</div>
	);
}
