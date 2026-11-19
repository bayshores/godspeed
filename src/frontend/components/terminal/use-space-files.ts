import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "@/frontend/lib/api";
import { spaceUrl, type SpaceRead } from "@/frontend/components/files/space-record";
import { useSpaces } from "@/frontend/components/space-context";
import { useServerEvent } from "@/frontend/components/server-events";
import type { LinkFile } from "./terminal-links-model";

/** Every space's files, for the names the agent's screen can link. Read
 *  when a screen shows and again when spaces change. A space that fails to
 *  read just has no links. */
export function useSpaceFiles(): LinkFile[] {
	const { spaces } = useSpaces();
	const ids = spaces.map((s) => s.id).join(" ");
	const [files, setFiles] = useState<LinkFile[]>([]);
	const request = useRef(0);
	const load = useCallback(async () => {
		const id = ++request.current;
		const records = await Promise.all(
			ids
				.split(" ")
				.filter(Boolean)
				.map(async (spaceId) => (await getJson<SpaceRead>(spaceUrl(spaceId))).body),
		);
		if (id !== request.current) return;
		setFiles(records.flatMap((r) => r?.space.files.map((f) => ({ id: f.id, name: f.name, spaceId: r.space.id, space: r.space.name })) ?? []));
	}, [ids]);
	useEffect(() => {
		void load();
	}, [load]);
	useServerEvent("spaces-changed", () => void load());
	return files;
}
