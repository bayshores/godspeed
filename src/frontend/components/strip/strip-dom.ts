/** How wide the strip down the window's right edge is, 0 where there is none (the first steps, a window of the terminal's own). */
export const stripWidth = (): number => document.querySelector<HTMLElement>("[data-strip]")?.offsetWidth ?? 0;
