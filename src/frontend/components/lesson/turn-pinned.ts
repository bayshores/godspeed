import { createContext } from "react";

/** Whether "Your turn" stands pinned at the window's foot, under the lesson text (LessonScroll): there it is only as tall as what the learner can do now. */
export const TurnPinned = createContext(false);
