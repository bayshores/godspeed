import { useEffect, useState } from "react";
import type { CitedPassage, FileCite } from "./page-excerpt-model";

/** GET /api/cited for a space file's source, with its quote when it has
 *  one: null while loading, "gone" when the file or place is missing. */
export function useCited({ fileId, range, quote }: FileCite): CitedPassage | "gone" | null {
	const [got, setGot] = useState<{ key: string; passage: CitedPassage | "gone" } | null>(null);
	const url = `/api/cited/${fileId}?range=${encodeURIComponent(range)}${quote ? `&quote=${encodeURIComponent(quote)}` : ""}`;
	useEffect(() => {
		let live = true;
		fetch(url)
			.then((res): Promise<CitedPassage | "gone"> => (res.ok ? res.json() : Promise.resolve("gone")))
			.catch((): "gone" => "gone")
			.then((passage) => {
				if (live) setGot({ key: url, passage });
			});
		return () => {
			live = false;
		};
	}, [url]);
	return got && got.key === url ? got.passage : null;
}
