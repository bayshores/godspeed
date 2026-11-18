import { useCallback, useMemo, useState, type ComponentProps, type CSSProperties } from "react";
import { citeLabel, citeView, type Cite } from "@/shared/core";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { cn } from "@/frontend/lib/utils";
import { CiteContext } from "./cite-context";
import { CiteDialog } from "./cite-dialog";
import { PageExcerpt } from "./page-excerpt";
import { pageSource, splitAfterSource, type FileCite } from "./page-excerpt-model";

/** A mark still being written, at the end of text that is streaming in. */
const HALF_MARK = /\[\[[^\]\n]*\]?$/;

/** Sources step in after the last block of a reply that landed (.lh-set). */
const SOURCES_LAST = { "--lh-block-delay": "240ms" } as CSSProperties;

/** The teacher's text with its source marks as numbers, a "Sources" list
 *  under it, and the popup a space file's source opens. `page` is a topic's
 *  stored page mark: its page draws under the paragraph that cites it. A
 *  reply that just `landed` draws in block by block, Sources last. */
export function CitedResponse({
	text,
	isAnimating,
	className,
	page,
	landed,
}: { text: string; page?: string; landed?: boolean } & Pick<ComponentProps<typeof MessageResponse>, "isAnimating" | "className">) {
	const body = cn(className, landed && "lh-set");
	const shown = isAnimating ? text.replace(HALF_MARK, "") : text;
	const view = useMemo(() => citeView(shown), [shown]);
	const source = useMemo(() => (page ? pageSource(shown, view.cites, page) : null), [page, shown, view.cites]);
	const [head, tail] = useMemo(() => (source ? splitAfterSource(view.text, source.n, source.nth) : [view.text, ""]), [source, view.text]);
	const [opened, setOpened] = useState<FileCite | null>(null);
	const open = useCallback((cite: Cite) => {
		if (cite.kind === "file") setOpened(cite);
	}, []);
	const context = useMemo(() => ({ cites: view.cites, open }), [view.cites, open]);
	return (
		<CiteContext.Provider value={context}>
			{source ? (
				<div className="flex flex-col gap-4">
					<MessageResponse isAnimating={isAnimating} className={body}>
						{head}
					</MessageResponse>
					<PageExcerpt cite={source.cite} onOpen={() => setOpened(source.cite)} />
					{tail && (
						<MessageResponse isAnimating={isAnimating} className={body}>
							{tail}
						</MessageResponse>
					)}
				</div>
			) : (
				<MessageResponse isAnimating={isAnimating} className={body}>
					{view.text}
				</MessageResponse>
			)}
			{view.cites.length > 0 && (
				<div data-testid="cite-list" className={cn("mt-3 flex flex-col gap-1 pt-2", landed && "lh-block-in")} style={SOURCES_LAST}>
					<div className={LABEL_TEXT}>Sources</div>
					<ul className="flex flex-col gap-0.5 text-[15px]">
						{view.cites.map((cite, i) => (
							<li key={i} data-testid="cite-row" className="flex gap-2">
								<span className="shrink-0 text-ink-2">{i + 1}</span>
								<CiteRowLink cite={cite} open={open} />
							</li>
						))}
					</ul>
				</div>
			)}
			<CiteDialog cite={opened} onClose={() => setOpened(null)} />
		</CiteContext.Provider>
	);
}

const ROW_LINK = "min-w-0 break-words text-left text-ink underline underline-offset-2 hover:text-ink-max";

function CiteRowLink({ cite, open }: { cite: Cite; open: (cite: Cite) => void }) {
	if (cite.kind === "web")
		return (
			<a href={cite.url} target="_blank" rel="noopener noreferrer" className={ROW_LINK}>
				{citeLabel(cite)}
			</a>
		);
	return (
		<button type="button" onClick={() => open(cite)} className={ROW_LINK}>
			{citeLabel(cite)}
		</button>
	);
}
