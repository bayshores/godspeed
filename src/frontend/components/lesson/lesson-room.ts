import { APP_ROOM, type SheetRoom } from "@/frontend/components/use-sheet-glide";

/** The lesson's window: also whether "Your turn" is pinned under it (the window is laid out for a pinned one a moment
 *  after that one left), and its height, which the pinned "Your turn" glides. */
export const LESSON_ROOM: SheetRoom = {
	key: (el) => `${APP_ROOM.key(el)} ${el.closest(".lh-lesson-window")?.classList.contains("lh-lesson-pinned") ?? ""}`,
	windowHeight: (el) => el.closest(".lh-lesson-window")?.clientHeight ?? null,
};
