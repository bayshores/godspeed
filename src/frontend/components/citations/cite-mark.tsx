import { useContext } from "react";
import { citeLabel } from "@/shared/core";
import { CiteContext } from "./cite-context";

/** The small raised number after a sentence. It shows nothing when the
 *  message has no source with that number. */
export function CiteMark({ n }: { n?: string }) {
	const ctx = useContext(CiteContext);
	const number = Number(n);
	const cite = ctx?.cites[number - 1];
	if (!ctx || !cite) return null;
	const props = {
		className: "lh-cite",
		"data-testid": "cite-mark",
		// In-app find skips the digit.
		"data-session-find-exclude": "",
		"aria-label": `Source ${number}, ${citeLabel(cite)}`,
	};
	if (cite.kind === "web")
		return (
			<a {...props} href={cite.url} target="_blank" rel="noopener noreferrer">
				{number}
			</a>
		);
	return (
		<button {...props} type="button" onClick={() => ctx.open(cite)}>
			{number}
		</button>
	);
}
