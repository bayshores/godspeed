import { useEffect, useState } from "react";

/** The desktop app's zoom factor: 1 in a browser, and until the shell answers. */
export function useZoom(): number {
	const [factor, setFactor] = useState(1);
	useEffect(() => {
		// The first paint can beat the first push.
		void window.lh?.getZoom?.().then(setFactor);
		return window.lh?.onZoom?.(setFactor);
	}, []);
	return factor;
}
