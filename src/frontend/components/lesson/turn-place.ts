import { createContext } from "react";

/** Where "Your turn" stands on the lesson page (LessonScroll): beside the lesson text as the
 *  right page of the open book, alone in the middle while the text draws nothing, pinned at the
 *  window's foot under the text, or in the page under the text. */
export type TurnPlace = "beside" | "alone" | "pinned" | "under";

/** The place "Your turn" is drawn in. Pinned, it is only as tall as what the learner can do
 *  now; beside the text or alone it also keeps the task he last finished. */
export const TurnPlaceContext = createContext<TurnPlace>("under");
