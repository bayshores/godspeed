import { createContext } from "react";

/** Where the turn's task stands on the lesson page (LessonScroll): beside the lesson text as the
 *  right page of the open book (tight: in a room too low for the task he last finished), alone in
 *  the middle while the text draws nothing, pinned over the text (an open problem in one column),
 *  or in the page under the text. */
export type TurnPlace = "beside" | "tight" | "alone" | "pinned" | "under";

/** The place the task is drawn in. Beside the text or alone it also keeps the task he last
 *  finished. With no page around it, it is drawn whole. */
export const TurnPlaceContext = createContext<TurnPlace>("beside");

/** The boxes the lesson page moves the turn's two parts in (the task, the writing row), the place
 *  on the step line for the task's own key, and how the turn stands: leaving (a lesson reset) or
 *  stepping in after a reply. */
type TurnSlots = { task?: HTMLElement; row?: HTMLElement; line?: HTMLElement | null; closing: boolean; stepIn: boolean };

/** With no page around it, the turn draws its parts where it stands. */
export const TurnSlotsContext = createContext<TurnSlots>({ closing: false, stepIn: false });
