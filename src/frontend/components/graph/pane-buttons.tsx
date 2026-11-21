/** The topic and fact panels' keys: the main Study key, and the quiet Close. */
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/** A panel's main key at the panel's foot, as wide as its word, with why the last start failed under it. */
export function StudyButton({ label, onClick, busy, error, testid }: { label: string; onClick: () => void; busy: boolean; error: string | null; testid: string }) {
	return (
		<div className="flex shrink-0 flex-col items-end gap-2">
			<button type="button" data-testid={testid} disabled={busy} onClick={onClick} className="lh-btn lh-btn-main">
				<span className="min-w-0 truncate">{label}</span>
			</button>
			{error && (
				<p role="alert" data-testid="study-start-error" className="text-sm text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}

/** A panel's quiet Close. */
export function CloseButton({ testid, onClick }: { testid: string; onClick: () => void }) {
	return (
		<button type="button" data-testid={testid} onClick={onClick} className="lh-btn lh-btn-quiet lh-btn-small shrink-0">
			<PixelIcon name="close" />
			Close
		</button>
	);
}
