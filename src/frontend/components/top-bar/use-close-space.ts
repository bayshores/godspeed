import { useState } from "react";
import { useNavigate } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { jsonInit, send } from "@/frontend/components/files/space-files-api";

type Space = { id: string };

/**
 * Closes and reopens spaces (stored as `archived`). Closing the space on
 * screen goes to Today; reopening one switches the window to it. A refused
 * request keeps its error and changes nothing.
 */
export function useCloseSpace() {
	const { active, setActive, refresh } = useSpaces();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const write = async (space: Space, closed: boolean): Promise<boolean> => {
		setBusy(true);
		setError(null);
		const { error: failed } = await send(`/api/spaces/${encodeURIComponent(space.id)}`, jsonInit("PUT", { archived: closed }));
		// The bar changes with the click, not when the server's event arrives.
		if (!failed) await refresh();
		setBusy(false);
		setError(failed);
		return !failed;
	};

	return {
		busy,
		error,
		/** `onScreen`: its tab is the lit one. */
		close: async (space: Space, onScreen: boolean): Promise<boolean> => {
			if (!(await write(space, true))) return false;
			if (space.id === active) setActive(null);
			if (onScreen) navigate("/");
			return true;
		},
		reopen: async (space: Space): Promise<boolean> => {
			if (!(await write(space, false))) return false;
			setActive(space.id);
			navigate("/space");
			return true;
		},
	};
}
