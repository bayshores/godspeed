import { useState } from "react";

/**
 * A page picture filling its box that never goes blank when its address changes (a sharper
 * size, another ink): the picture it has stays until the new one has loaded over it, unseen
 * (data-loading while it loads).
 * `onFail` is told when the picture shown does not load; a new one that does not load leaves
 * the old in place and is logged.
 */
export function SteadyImg({ src, alt, onFail }: { src: string; alt: string; onFail: () => void }) {
	const [shown, setShown] = useState(src);
	return (
		<>
			<img src={shown} alt={alt} loading="lazy" decoding="async" onError={onFail} className="absolute inset-0 block h-full w-full" />
			{src !== shown && (
				<img
					src={src}
					alt=""
					aria-hidden
					data-loading=""
					decoding="async"
					onLoad={() => setShown(src)}
					onError={() => console.error(`[page picture] couldn't load ${src}; the picture before it stays`)}
					className="absolute inset-0 block h-full w-full opacity-0"
				/>
			)}
		</>
	);
}
