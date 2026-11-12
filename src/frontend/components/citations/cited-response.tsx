import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { citeLabel, citeView, type Cite } from "@/shared/core";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { CiteContext } from "./cite-context";
import { CiteDialog, type FileCite } from "./cite-dialog";

/** A mark still being written, at the end of text that is streaming in. */
const HALF_MARK = /\[\[[^\]\n]*\]?$/;

/** The teacher's text with its source marks as numbers, a "Sources" list
 *  under it, and the popup a space file's source opens. */
export function CitedResponse({ text, isAnimating, className }: { text: string } & Pick<ComponentProps<typeof MessageResponse>, "isAnimating" | "className">) {
	const view = useMemo(() => citeView(isAnimating ? text.replace(HALF_MARK, "") : text), [text, isAnimating]);
	const [opened, setOpened] = useState<FileCite | null>(null);
	const open = useCallback((cite: Cite) => {
		if (cite.kind === "file") setOpened(cite);
	}, []);
	const context = useMemo(() => ({ cites: view.cites, open }), [view.cites, open]);
	return (
		<CiteContext.Provider value={context}>
			<MessageResponse isAnimating={isAnimating} className={className}>
				{view.text}
			</MessageResponse>
			{view.cites.length > 0 && (
				<div data-testid="cite-list" className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
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

const ROW_LINK = "min-w-0 truncate text-left text-ink underline underline-offset-2 hover:text-ink-max";

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
