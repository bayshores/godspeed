# Keyboard shortcuts

How shortcuts work in the code. Read this before you add, change or debug a shortcut.

Most learners use the mouse, so a shortcut is always an extra, never the only way to do something. In the app, `?` opens the full list. The keys are fixed: there is no way to change them, and keys an older version saved in localStorage under `lh:keymap` are no longer read.

## Where the code lives

| Part | File | What it does |
|---|---|---|
| Registry | `src/shared/core/keyboard.ts` | `KEYBOARD_ACTIONS` lists every action as `{ id, label, scope, binding }`. The cheat sheet is drawn from it. |
| Provider | `src/frontend/components/keyboard-shortcuts.tsx` | One window-level keydown listener. It runs an action itself or sends a `lh:kbd-<action-id>` window event. |
| Focus helpers | `src/frontend/components/focus-hygiene.ts` | `trapTabInDialog` and `showFocusRingAfterTab`. |

How a key press becomes an action:

1. The provider turns the key press into a string like `mod+b` (`eventBinding`).
2. It looks the string up in the key map (`actionForBinding`).
3. It runs the action itself, or sends the window event.
4. The page that owns the action listens for that event. If that page isn't open, nothing happens.

`mod` means ⌘ on a Mac and Ctrl elsewhere. Both work on a Mac.

There is no conflict check. If two actions share a key, the one later in the registry wins, because the key map overwrites as it is built.

Entries marked `displayOnly` are keys that one surface owns, like the question rows below. They are listed for the cheat sheet only. The provider never sends them, so arrow keys stay free on every other page.

## Rules

- Tab moves focus as usual, through buttons and links too. An open question claims Tab from its rows (see below). An open modal dialog keeps Tab inside itself (`trapTabInDialog`).
- Inside a text field only shortcuts with a modifier fire, like ⌘B. Bare keys, `?` included, type normally.
- One Esc does one thing. The top open layer handles it first: the cheat sheet, a popover, menu or dialog, or the focused field's own action.
- When nothing is open, Esc stops the running turn. A turn the server started has no browser request to stop, so the lesson decides what Esc can stop.
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
| Find | ⌘F | the open page: topic search on `/graph` (`src/frontend/components/graph/graph-top-bar.tsx`) or text Find in a lesson (`src/frontend/components/session-find.tsx`) |
| Show keyboard shortcuts | ? | `keyboard-shortcuts.tsx` |

Search lessons opens a popup over every space. In its search field ↑/↓ walk the results, and Enter opens one (the first match if none is picked).

## Question rows

While a question is open, `src/frontend/components/question-dock.tsx` owns these keys. They work only when focus is not in a text field, and never with a modifier held.

| Key | What it does |
|---|---|
| 1 to 9 | Picks that option. Pressed again on a one-answer question, clears the pick. |
| 0 | Picks "I don't know" on a quiz. |
| ↑/↓ | Walk the rows: the options, then "I don't know" on a quiz. The walk stops at the ends. |
| ←/→ | Change the "How sure are you?" level on a quiz, once an answer is picked (not "I don't know"). |
| Space | Acts on the walked row like a click. |
| Enter | Submits, once a row is walked and there is an answer. |
| Tab | From the rows, moves focus to the lesson's writing box. With nothing focused, moves focus into the rows. |

From the writing box, Tab moves on as usual, so it reaches Submit.
