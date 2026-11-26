/** How wide the strip down the window's right edge is, 0 where there is none (the first steps, the chat's own window). */
export const stripWidth = (): number => document.querySelector<HTMLElement>("[data-strip]")?.offsetWidth ?? 0;
