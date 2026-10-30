# Keyboard shortcuts

How shortcuts work in the code. Most learners use the mouse, so a shortcut
is always an extra, never the only way to do something. In the app, `?`
opens the full list, and **Settings → Keyboard** lets the learner change
the keys.

## Where the code lives

- **Registry**: `src/core/keyboard.ts`. `KEYBOARD_ACTIONS` lists every
  action as `{ id, label, scope, binding }`. The cheat sheet and the
  Settings list are drawn from it, so they never show a shortcut that
  does nothing.
- **Provider**: `src/components/keyboard-shortcuts.tsx`. One window-level
  keydown listener. It turns a key press into a string like `mod+b`,
  looks it up (with the learner's changes applied), and either runs the
  action itself or sends a `lh:kbd-<action-id>` window event. The page
  that owns the action listens for that event. If that page isn't open,
  nothing happens.
- **Changed keys**: saved in the browser's localStorage under `lh:keymap`
  as `{actionId: binding}`, on top of the defaults.
  `src/components/settings/keyboard-section.tsx` edits them. There is no
  conflict check: if two actions share a key, the one later in the
  registry wins (`effectiveKeymap` overwrites as it goes).
- **displayOnly entries**: keys that one surface owns (the question rows
  below) are listed for the cheat sheet only. The provider never sends
  them, so arrow keys stay free on every other page.

`mod` means ⌘ on a Mac and Ctrl elsewhere (both work on a Mac).

## Rules

- **Tab never moves browser focus.** Plain Tab cycles the text fields
  of the page you are on, forward only, wrapping
  (`src/components/field-cycle.ts`). An open question claims Tab first
  (see below).
- **Inside a text field only shortcuts with a modifier fire** (like ⌘B).
  Bare keys, `?` included, type normally.
- **One Esc does one thing.** The top open layer handles it first: the
  cheat sheet, a popover, menu or dialog, or the focused field's own
  action. When nothing is open, Esc stops the running turn. A turn the
  server started has no browser request to stop, so the lesson decides
  what Esc can stop.
- **No focus ring.** `src/app/globals.css` turns off the browser's focus
  outline everywhere. Surfaces show their own hover and selected styles.

## Key map

| Action | Default | Who handles it |
|---|---|---|
| Open settings | ⌘, | `keyboard-shortcuts.tsx` |
| Toggle sidebar | ⌘B | `src/components/sidebar.tsx` |
| Search lessons | ⌘⇧F | `src/components/sidebar/lessons-section.tsx`. In the search field ↑/↓ walk the results and Enter opens one (the first match if none is picked) |
| Graph view | ⌘G | `keyboard-shortcuts.tsx`, goes to `/graph` |
| New lesson | ⌘N | `keyboard-shortcuts.tsx`, goes to `/new` |
| Rename lesson | F2 | `src/components/lesson/use-title-rename.ts` |
| Toggle all your thinking | ⌘T | `src/components/chat.tsx` |
| Find | ⌘F | the open page: topic search on `/graph` (`src/components/graph/graph-top-bar.tsx`), text Find in a lesson (`src/components/session-find.tsx`) |
| Shortcut cheat sheet | ? | `keyboard-shortcuts.tsx` |

## Question rows

While a question is open, `src/components/question-dock.tsx` owns these
keys. They only work when focus is not in a text field, and never with a
modifier held:

- **1 to 9** pick that option. **0** picks "I don't know" on a quiz.
- **↑/↓** walk the rows: the options, then "I don't know" or "Other…".
  The walk stops at the ends.
- **←/→** change the confidence level on a quiz (not after "I don't
  know").
- **Space** acts on the walked row like a click.
- **Enter** submits once there is an answer.
- **Tab** switches focus between the thinking field and the rows. This
  one also works from the thinking field.