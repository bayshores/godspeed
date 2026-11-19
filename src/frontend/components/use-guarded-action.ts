import { useCallback, useRef, useState } from "react";
import type { WriteResult } from "@/frontend/lib/api";

/**
 * A request the learner starts with a click: `busy` while it runs, and a
 * second click meanwhile does nothing; then `error` is its error line, or
 * null. `act` resolves to that line. With `stayBusy`, a dialog that closes
 * on success stays busy through its closing until `reset`.
 */
export function useGuardedAction({ stayBusy = false }: { stayBusy?: boolean } = {}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const running = useRef(false);
	const run = useCallback(
		async (act: () => Promise<WriteResult>): Promise<boolean> => {
			if (running.current) return false;
			running.current = true;
			setBusy(true);
			setError(null);
			const failed = await act();
			if (failed === null && stayBusy) return true;
			running.current = false;
			setBusy(false);
			setError(failed);
			return failed === null;
		},
		[stayBusy],
	);
	const reset = useCallback(() => {
		running.current = false;
		setBusy(false);
		setError(null);
	}, []);
	return { busy, error, setError, run, reset };
}
