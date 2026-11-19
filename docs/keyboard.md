# Keyboard shortcuts

How shortcuts work in the code. Read this before you add, change or debug a shortcut.

Most learners use the mouse, so a shortcut is always an extra, never the only way. In the app `?` opens the full list. Keys are fixed and cannot be changed; keys an older version saved in localStorage under `lh:keymap` are no longer read.

A button whose action has a shortcut shows the key inside it, read from the list in `src/shared/core/keyboard.ts`. `KeyHint` draws the key and `keyShortcutProps` adds `aria-keyshortcuts`, both in `src/frontend/components/ui/key-hint.tsx`. Tooltips carry no key, and a key is never typed by hand.

## Where the code lives

| Part | File | What it does |
|---|---|---|
| Registry | `src/shared/core/keyboard.ts` | `KEYBOARD_ACTIONS` lists every action as `{ id, label, scope, binding }`. The cheat sheet is drawn from it. |
| Provider | `src/frontend/components/keyboard-shortcuts.tsx` | One window-level keydown listener. Runs an action itself or sends a `lh:kbd-<action-id>` window event. |
| Focus helpers | `src/frontend/components/focus-hygiene.ts` | `trapTabInDialog` and `showFocusRingAfterTab`. |

A key press becomes an action in four steps:

1. The provider turns it into a string like `mod+b` (`eventBinding`).
2. It looks the string up in the key map (`actionForBinding`).
3. It runs the action itself, or sends the window event.
4. The page that owns the action listens for the event. If that page isn't open, nothing happens.

`mod` is ⌘ on a Mac and Ctrl elsewhere; both work on a Mac.

There is no conflict check. If two actions share a key, the later one in the registry wins, because the key map overwrites as it is built.

Entries marked `displayOnly` are keys one surface owns, like the question rows below. They are listed for the cheat sheet only. The provider never sends them, so arrow keys stay free on every other page.

## Rules

- Tab moves focus as usual, through buttons and links too. An open question claims Tab from its rows (see below). An open modal dialog keeps Tab inside itself (`trapTabInDialog`).
- In a text field only shortcuts with a modifier fire, like ⌘B. Bare keys, `?` included, type normally.
- In the agent's terminal every key goes to the agent. Shift+Enter is sent as Ctrl+J (a line feed), which Claude Code and Codex read as a new line, so it adds a line instead of sending. On a Mac, Cmd+Backspace is sent as Ctrl+U, which clears the line.
- One Esc does one thing. The top open layer handles it first: the cheat sheet, a popover, menu or dialog, or the focused field's own action.
- With nothing open, Esc stops the running reply at once, like the Stop button, and what it wrote stays. On a waiting question or an open problem it asks first (Skip question, Discard problem). A turn the server started has no browser request to stop, so the lesson decides what Esc can stop.
- The focus ring shows after Tab, or after an arrow key that moves focus, and hides on the next mouse press (`showFocusRingAfterTab`, drawn in `src/frontend/globals.css`). A hidden color picker rings its tile instead.

## Key map

| Action | Key | Who handles it |
|---|---|---|
| Open Settings | ⌘, | `keyboard-shortcuts.tsx`, goes to `/settings` |
| Search lessons | ⌘⇧F | `src/frontend/components/search-lessons.tsx` |
| Go to Graph | ⌘G | `keyboard-shortcuts.tsx`, goes to `/graph` |
| Study | ⌘N | `keyboard-shortcuts.tsx`, goes to `/new` |
| Rename lesson | F2 | `src/frontend/components/lesson/use-title-rename.ts` |
| Show or hide all your thinking | ⌘T | `src/frontend/components/chat.tsx` |
| Find | ⌘F | the open page: Find in the top bar of `/graph` (with no facts it does nothing) or of the Files page (both share `src/frontend/components/use-bar-find.ts`) or text Find in a lesson (`src/frontend/components/session-find.tsx`) |
| Show keyboard shortcuts | ? | `keyboard-shortcuts.tsx` |

On the Mac the menu bar owns ⌘, (godspeed, Settings…), ⌘N (File, Study), ⌘⇧F (File, Search Lessons), ⌘G (Go, Graph), ⌘[ (Go, Back) and ⌘] (Go, Forward). Those keys never reach the page there; the menu pushes the item to the page, which runs it through the same code as the key. In a browser the page's listener handles ⌘N, ⌘⇧F, ⌘G and ⌘, (comma), and ⌘[ and ⌘] do nothing.

Search lessons opens a popup over every space. In its field ↑/↓ walk the results and Enter opens one (the first match if none is picked).

## Graph topics

The Graph page's picture (`src/frontend/components/graph/constellation.tsx`) is one Tab stop: the topic last moved to or picked, else the leftmost one. Focus stays on a topic while its panel opens beside the picture. When the panel takes the picture's place, focus moves to the panel's Close, and closing gives it back to the topic.

| Key | What it does |
|---|---|
| Tab | Moves focus into the picture, on one topic, and out again. |
| ← → ↑ ↓ | Moves to the nearest topic in that direction; zoomed in, one outside the view comes into it. |
| Enter or Space | Picks the topic and opens its panel. Pressed on the picked topic, closes it. |
| Esc | In Find's field in the top bar, clears and closes Find and keeps any open panel (`use-bar-find.ts`). Otherwise closes the open fact, then the open topic, then flies a zoomed-in picture back to the whole space (`graph-body.tsx`). |

## Question rows

While a question is open, `src/frontend/components/question-dock.tsx` owns these keys. The rows of a choice problem (`open-problem-pane.tsx`) use the same keys through `use-choice-keys.ts`; there Enter sends and Tab moves to the "Your work" box. They work only when focus is not in a text field, and never with a modifier held.

| Key | What it does |
|---|---|
| 1 to 9 | Picks that option. Pressed again on a one-answer question, clears the pick. |
| ↑/↓ | Walk the options. Stops at the ends. |
| ←/→ | Change the "How sure are you?" level on a quiz, once an answer is picked. |
| Space | Acts on the walked row like a click. |
| Enter | Submits, once a row is walked and there is an answer. |
| Tab | From the rows, moves focus to the lesson's writing box. With nothing focused, moves focus into the rows. |

From the writing box, Tab moves on as usual, so it reaches Submit.
