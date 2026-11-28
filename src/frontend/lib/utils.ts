import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** The names globals.css adds to the type ladder. Unnamed here, the merger reads `text-ui` as a color and drops it for the next one. */
const merge = extendTailwindMerge({ extend: { theme: { text: ["ui", "item", "tab", "head", "ask"], leading: ["title", "ask", "ui"] } } });

export function cn(...inputs: ClassValue[]) {
	return merge(clsx(inputs));
}
