"use client";

import { useLayoutEffect, useState } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { decodeFrame } from "./decode-model";

const DECODE_MS = 220;

/**
 * A title that decodes when it appears or changes: its letters scramble
 * through block letters and settle left to right. Titles only, never
 * reading text. Server renders and Reduce motion show it settled.
 */
export function Decode({ text }: { text: string }) {
	const [shown, setShown] = useState(text);
	useLayoutEffect(() => {
		if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
			setShown(text);
			return;
		}
		const start = performance.now();
		let frame = 0;
		let raf = 0;
		const tick = () => {
			const t = (performance.now() - start) / DECODE_MS;
			setShown(t >= 1 ? text : decodeFrame(text, t, frame++));
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		tick();
		return () => cancelAnimationFrame(raf);
	}, [text]);
	return <>{shown}</>;
}
