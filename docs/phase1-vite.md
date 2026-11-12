# Phase 1: the UI without Next.js pages

Part of [rust-rewrite-plan.md](rust-rewrite-plan.md). The screens become a static Vite + React Router app. Next.js stays only for `/api/*` (and `/pdfjs/*`) until the Rust server replaces it in Phase 3. Every screen must look the same as the Phase 0 Chromium baseline (`rewrite-lab/screens/baseline/chromium`).

## Versions

| Package | Version | Why this one |
|---|---|---|
| `vite` | 8.3.5 (dev) | newest release at least two weeks old |
| `@vitejs/plugin-react` | 6.1.2 (dev) | same rule; needs Vite 8 |
| `@tailwindcss/vite` | 4.3.3 (dev) | same version as `tailwindcss` |
| `react-router` | 8.5.1 | data router (loaders); `RouterProvider` comes from `react-router/dom` |

Removed: `@tailwindcss/postcss`, `postcss`, `postcss.config.mjs`, `@next/eslint-plugin-next`.

## Folder layout

```
src/frontend/
  index.html          the page (no <title>: each screen renders its own)
  main.tsx            entry: CSS, makes the browser router, reads /api/boot and the first screen's data, then renders once
  globals.css         moved from src/app/ (Tailwind scans the whole repo: source("../.."))
  fonts/              the woff2 files and fonts.css
  routes/
    router.tsx        every route (the route list, `routes`)
    root.tsx          what src/app/layout.tsx rendered: providers, app frame or onboarding, notices
    space-layout.tsx  the space head and tabs around the space pages
    settings.tsx      /settings
    lesson.tsx        /chat/:id loader + screen
    deadline.tsx      /space/deadline/:id and .../cheat-sheet loader + screens
    mock.tsx          /space/mock/:spaceId/:mockId loader + screen
    not-found.tsx     NotFound (moved from src/app/not-found.tsx) and PageError
    page-title.tsx    <title>godspeed / page</title>
  components/boot.tsx BootProvider, useBoot(), fetchBoot(), showsWelcome()
  lib/lazy-component.tsx  replaces next/dynamic
public/icon.png       moved from src/app/icon.png
src/app/              api/**, pdfjs/[...path], and [[...path]] (serves the built UI) only
```

The import law covers all of `src/frontend` (was `src/frontend/components`): it imports only the `@/shared/core` barrel.

## Routes

| Path | Screen | Title (`godspeed / …`) | Loader |
|---|---|---|---|
| `/` | `HomePage` | plain `godspeed` | none |
| `/new` | `NewLesson` | `Study` | none |
| `/prep` | `PrepStart` | `Prepare` | none |
| `/settings` | `SettingsPage` | `Settings` | none |
| `/archived` | `ArchivedSpaces` | `Archived spaces` | none |
| `/graph` | `GraphScreen` | `Graph` | none |
| `/space` | `SpaceHome` (Progress, or a prep's sheet) | `Progress` | none |
| `/space/lessons` | `LessonsList` | `Lessons` | none |
| `/space/files` | `FilesPage` | `Files` | none |
| `/space/cheat-sheets` | `SpaceSheetsPage` | `Cheat sheets` | none |
| `/space/deadlines` | `DeadlinesTab` | `Deadlines` | none |
| `/space/mocks` | `PrepMocksTab` | `Mocks` | none |
| `/space/deadline/:id` | `DeadlinePage` | deadline name | `GET /api/deadlines/:id` |
| `/space/deadline/:id/cheat-sheet` | `CheatSheetStudio` | `Cheat sheet for <name>` | same |
| `/space/mock/:spaceId/:mockId` | `MockPage` | `Mock <n>` | `GET /api/spaces/:id/mocks/:mockId` |
| `/chat/:id` | `Chat` | lesson title | `GET /api/chats/:id`, then for homework `GET .../homework` |
| anything else | `NotFound` | plain `godspeed` | none |

The pages from `/graph` to `/space/mocks` sit inside `SpaceLayout`. `tests/frontend/routes.test.tsx` checks that every address the UI links to has a page and that the loaders answer 404 where they should.

- A loader that gets 404 (or the Talk chat) throws a 404; `PageError` shows `NotFound` inside the app frame, like Next's `notFound()`. The mock loader treats any refusal as 404. Any other loader failure also shows `NotFound` and logs to the console.
- Its title keeps the old metadata fallback: `Lesson`, `Deadline`, `Cheat sheet` or `Mock` (`errorElement` on each loader route).
- Loaders make a navigation keep the old screen until the new one's data is in, as Next's server rendering did.
- `?prompt=` is read by the lesson loader (the page prop `initialPrompt`).
- Titles use React 19's `<title>` element, hoisted into `<head>`.

## The first paint

`main.tsx` waits for both `/api/boot` and the first screen's loader, then renders once, with the saved look (`appearance`) already in. A failed `/api/boot` renders the app with No space and no welcome screen (`UNREAD` in `components/boot.tsx`). React runs in `StrictMode`, as Next did.

## New endpoints

All are GET, JSON, behind the desktop secret like every `/api` route.

**`GET /api/boot`** (`src/app/api/boot/route.ts` → `src/backend/server/boot.ts` `bootInfo()`), `Cache-Control: no-store`, `force-dynamic`. It runs the old root layout's reads in the same order with the same try/catch fallbacks, so the side effects are unchanged: `onboardingNeeded()` (stamps `general.onboarded`, makes `data/mcp-token`), `whatsNewSince()` (stamps `general.lastSeenVersion`), `refreshAgentFolder()` (once per server start), `folderNoticeAgent()`, `firstLoadScreen()` (`"welcome"` or `"restarted"` on the first call of a server process, then null), then the settings and the space list. Every page load calls it once; onboarding's finish calls it again (`useBoot().refresh()`, which replaces `router.refresh()`). Response (`BootInfo`, `src/shared/core/contracts/boot.ts`):

```ts
{ onboarding: boolean;
  firstLoad: "welcome" | "restarted" | null;
  whatsNewSince: string | null;
  folderNotice: "claude" | "codex" | null;
  activeSpace: string | null;
  spaces?: SpaceSummary[];      // missing when unreadable
  teacherName?: string;
  sounds: boolean;
  appearance?: AppearanceSettings }  // missing means the defaults
```

Like the layout it imports only light modules, through `@/backend/server/boot` (an import-law exception next to the barrel), so the first paint never loads the whole server.

**`GET /api/deadlines/:id`** → `200 { spaceId, deadline: SpaceDeadline }` (`deadlineWithSpace`), or `404 { error: "No such deadline" }`.

**`GET /api/spaces/:id/deadlines/:deadlineId/homework`** → `200 { homework: HomeworkView }` (`homeworkView`), or `404 { error: "No such deadline" }` (also for an id that is not a space id).

## Serving the built UI

- `vite build` writes `dist-ui/` (gitignored). `public/` (sounds, icon) is Vite's public dir, so it lands there too.
- `scripts/build-server.mjs` copies `dist-ui/` to `.next/standalone/ui/` and no longer copies `.next/static` or `public/`. It removes the traced `dist-ui/` copy.
- `src/app/[[...path]]/route.ts` → `src/backend/server/ui-files.ts` `uiFile(parts)`: a path with any file extension is that file under `ui/` (404 if missing or outside `ui/`; an unknown extension is `application/octet-stream`); anything else is `index.html`. `api/...` paths are always 404. Cache: `assets/*` (hashed names) `public, max-age=31536000, immutable`; every 404 `no-store`; everything else `no-cache`.
- Phase 3 deletes `src/app/[[...path]]`, `ui-files.ts` and their test; the Rust server serves `ui/` with the same rules.
- `/pdfjs/*` stays a Next route (pdf.js worker and data from `node_modules/pdfjs-dist`).

## Fonts

`next/font/google` is gone. `src/frontend/fonts/` holds the woff2 files (latin and latin-ext each): Zen Kaku Gothic New (400 and 500), Literata (200 to 900, upright and italic) and DotGothic16 (400). `fonts.css` has their `@font-face` rules, a metric-matched fallback face for each (`Zen Kaku Gothic New Fallback`, `Literata Fallback`, `DotGothic16 Fallback`), and sets `--font-zen`, `--font-literata` and `--font-dot` on `:root`. `index.html` preloads the three latin files.

## Vite config (`vite.config.ts`)

- `root: src/frontend`, `publicDir: ../../public`, `build.outDir: ../../dist-ui`.
- Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`.
- Alias `@` → `src`.
- `define`: `process.env.LH_VERSION` and `process.env.LH_HOMEPAGE` from package.json, so components keep their code.
- `build.target`: chrome111, edge111, firefox111, safari16.4 (Next's targets).
- Dev: `server.port` = `PORT` (3000); `/api` and `/pdfjs` proxy to the API server on `PORT + 1000` (the Rust server in `npm run dev`).

## Scripts and Electron

Phase 1 ran the Next API under Vite and Electron. Since the Rust server and the Tauri shell came in, the scripts run those:

| Script | Now |
|---|---|
| `npm run dev` | `concurrently` runs the debug Rust server (`target/debug/godspeed-server`, `PORT + 1000`) and `vite` (UI on `PORT`, default 3000) |
| `npm run build` | `vite build` |
| `desktop:dev` | the debug Rust server build, `vite --host 127.0.0.1` and `tauri dev` |
| `desktop:local`, `desktop:dist` | `tauri build` (`desktop:dist` through `scripts/mac-dist.sh`) |

No script starts the Next API or Electron any more. The Node standalone that the contract lab records from is built by hand: `npx vite build && npx next build && node scripts/build-server.mjs`. In Phase 1, `electron/main.cjs` loaded the same URL as before (`LH_DEV_URL` in dev, the server's port in production). In dev it first polls `/api/ready` through Vite until it answers below 500 (Vite's proxy answers 502 until `next dev` is up). The window stays hidden until the renderer calls `window.lh.showWindow()` (preload → `lh:show-window`), which `Root` does after its first render; `main.tsx` renders only once `/api/boot` and the first loader are in. A page that never calls it is shown 5 seconds after `ready-to-show`. The desktop secret is still added to the main frame's `/api` requests, so `/api/boot` gets it. `scripts/smoke-server.mjs` also probes `/api/boot`.

## Lint, knip, TypeScript

- `eslint.config.mjs`: no Next plugin; `dist-ui/**` ignored; the frontend zones target `./src/frontend`; the `src/app` exception list is `index.ts`, `boot.ts`, `ui-files.ts` (`settings-read.ts` is deleted).
- `tsconfig.json`: excludes `dist-ui`. The `next` plugin and `.next/types` stay for the API routes.
- `knip`: finds `vite.config.ts` and `src/frontend/index.html` through its Vite plugin; no change needed.

## Component conversions (mechanical)

- `next/link` → `import { Link } from "react-router"`; `href` → `to`; drop `prefetch`.
- `useRouter()` → `useNavigate()`; `push(x)` → `navigate(x)`; `replace(x)` → `navigate(x, { replace: true })`.
- `usePathname()` → `useLocation().pathname`.
- `next/dynamic` → `lazyComponent(() => import(...).then((m) => m.X))` from `@/frontend/lib/lazy-component`.
- `router.refresh()` (onboarding only) → `useBoot().refresh()`.
- `"use client"` lines are removed (Vite has no server components).
- `// eslint-disable-next-line @next/next/no-img-element` comments are removed.
- `window.history.replaceState(null, ...)` in `chat.tsx` keeps React Router's state: pass `window.history.state`.
- Plain `<a href="/chat/...">` in the activity dock stays a full page load, as before.

## Tests

- New: `tests/backend/boot-routes.test.ts` (boot side effects and fields, deadline by id, homework) and `tests/backend/ui-files.test.ts` (the UI file rules).
- Changed: `tests/desktop/desktop-payload.test.ts` (dist-ui → ui, refuses a build without it).
- Frontend render tests replace Next's `AppRouterContext` with `<MemoryRouter initialEntries={[path]}>`; anything that renders a `Link` needs a router too. The `requestIdleCallback` stubs that only fed next/link's prefetch go. CSS tests read `src/frontend/globals.css`.

## Contract recordings (Phase 0 P0 item 2)

- The `pages-*` recordings pin Next page headers and are retired.
- Record `/api/boot` (fresh install, existing user, second call, restarted server), `/api/deadlines/:id` and `.../homework` on the Phase 1 server before Phase 2 uses them. The page side effects now live on `/api/boot`.
- The lab's `lib/server.mjs` now calls `/api/boot` after start-up (unless `keepFirstLoad`), so the welcome screen is used up the same way `GET /` used it before.

## Known differences

- CSS: identical rules except that media and container range queries stay as `(width>=40rem)` where Next wrote `(min-width:40rem)`. Same meaning in every supported engine.
- One JS bundle for all screens (about 1.4 MB, heavy parts like mermaid, pdf.js, MathLive and CodeMirror still load lazily) where Next split per page.

## Not in Phase 1

Code written for server rendering stays as it is, so the first frames don't change: values read after mount (`sidebar.tsx`, `sheet-dock.tsx`, `use-lesson-drafts.ts`, `whats-new.tsx`), `getServerSnapshot` arguments (`countdown.tsx`, `teacher-sprite.tsx`) and `typeof window` guards. Removing them is one later change, checked against the screenshots.

## Open decisions for the owner

1. Should a loader's server error (500) show `NotFound`, or a "couldn't load, Try again" screen? Today it shows `NotFound` and logs.
