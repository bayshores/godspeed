import { useEnterSubmits } from "@/frontend/components/enter-submits";

/** The lesson's go-ahead key, under the last line of the text; Enter away from a field presses it. */
export function GoAheadKey({ label, onGo }: { label: string; onGo: () => void }) {
	useEnterSubmits(onGo);
	return (
		<div className="pt-2 font-ui">
			<button type="button" data-testid="next-problem-button" onClick={onGo} className="lh-btn lh-btn-main">
				{label}
			</button>
		</div>
	);
}
