import { useEffect, useState } from "react";
import { readStorage } from "@/frontend/lib/storage";
import { DOCK_DEFAULT_W, dockWidth } from "./dock-model";

/** A dock's width: the one saved under `storageKey` when there is one, else the default, within what the window leaves. Read after mount. */
export function useDockWidth(storageKey?: string) {
	const [width, setWidth] = useState(DOCK_DEFAULT_W);
	useEffect(() => {
		const saved = storageKey ? Number(readStorage(storageKey)) : 0;
		setWidth(dockWidth(saved > 0 ? saved : DOCK_DEFAULT_W, window.innerWidth));
	}, [storageKey]);
	return [width, setWidth] as const;
}
