# Project instructions

## Project map (read this before searching; keep it current when structure changes)
Trippie finds the cheapest Indian domestic round-trip windows in a given month for a range of gaps between the outbound and return flights. Each round trip is priced as two one-way fares, and prices are in INR. The stack is Next.js 16 App Router, React 19, Tailwind 4, and TypeScript. Next.js 16 differs from your training data, so see AGENTS.md. Find the specific doc with grep instead of reading whole guides.
- Commands: `npm run dev` (usually http://localhost:3111), `npm test` (node --test on `src/lib/windows.test.ts`), `npm run lint`, `npm run build`. Environment variables are listed in `.env.example`.
- UI: `src/app/page.tsx` renders `src/components/Planner.tsx`, the only client component.
- API: `src/app/api/search` (GET), `api/history` (GET), `api/snapshot` (POST, requires the `x-cron-secret` header, refuses demo data).
- `src/lib/search.ts`: `parseSearch` is the single input validator for every route. `runSearch` has a 30-minute in-memory cache.
- `src/lib/windows.ts`: pure date math and `computeWindows`. It's unit-tested.
- `src/lib/providers/`: `getProvider()` returns `travelpayouts` if `TRAVELPAYOUTS_TOKEN` is set, otherwise `demo`.
- `src/lib/store.ts`: `node:sqlite` database at `data/trippie.db` (gitignored). Use parameterized SQL only.
- `src/lib/links.ts` holds booking-site links keyed by fare `source`. `airports.ts` holds `AIRPORTS`. `types.ts` holds `DayFare`, `FareProvider`, `TripWindow`.
- Convention: inside `src/lib`, import siblings with a `.ts` extension, which `node --test` needs. App code imports via `@/lib/...`.

## Advisor strategy (model routing)
You are the executor: do the task end-to-end yourself. Specialist subagents run on other models. Call them with the subagent tool, and only when it's worth what they cost.
If you are running as the Advisor, Scout, or Reviewer subagent, ignore this section.

- **Scout** (Haiku, cheap): delegate broad exploration, such as "where is X / how does Y flow / what does this lib expect". Use it when you'd otherwise read more than 3-4 files just to orient yourself.
- **Advisor** (Opus, expensive): use at most 3 calls per task. Skip it if you are already running on Opus. Consult it ONLY:
  - before a hard-to-reverse choice: data model or schema, auth or sessions, state management, routing structure, a new dependency, or public API shape
  - after failing twice on the same bug or test
  - when the requirements are ambiguous and the interpretations lead to different code
  - for security-sensitive code: auth, payments, uploads, user input reaching the DB, HTML, or a shell, secrets, CORS or CSP
  - before refactoring more than 5 files

  Never consult it for CRUD, styling, copy, config tweaks, or obvious bugs.
  The Advisor can't see your context, so send a brief of about 1,500 tokens or fewer:
  `GOAL / STACK / STATE / CODE (snippets with path:line, never whole files) / TRIED (trimmed errors) / OPTIONS / QUESTION`.
  Follow its verdict. If it says STOP, report its reason to the user.
- **Reviewer** (GPT-6.1 Sol): call it once at the end for non-trivial changes (roughly 50+ lines, security-sensitive, or touching core logic). Give it the goal and the changed files. Fix BLOCKING items and ignore nitpicks.

## Working rules
- Plan small, act, verify by running the build, lint, or tests. Check UI changes in the browser.
- Don't re-read files that are already in context. Read targeted line ranges.
- Follow existing conventions. Make minimal changes.
- Write secure web code: validate input at boundaries, use parameterized queries, encode output, use no `eval` or `innerHTML` with user data, and keep secrets out of the client bundle.
- Final report: 2-5 lines covering what changed, how it was verified, and anything left open.

## Context discipline (keep chats long-lived)
- Search before reading: use grep or file search, then read only the matching line ranges. Never read `package-lock.json`, `.next/`, `node_modules/` (except targeted Next.js docs), or `.playwright-mcp/`.
- Keep terminal output small. Chain commands into one call and trim output, for example `npm run build 2>&1 | Select-Object -Last 40` or `npm run lint -- --quiet`. Never dump full logs, JSON payloads, or HTML.
- For browser checks, prefer an accessibility snapshot of a specific element over full-page snapshots or screenshots. Close tabs you no longer need.
- Use the todo list for multi-step work, so the plan survives compaction.
- Durable facts you had to discover the hard way (gotchas, commands, decisions) go in `/memories/repo/` as one-line bullets. Check there before re-investigating. If a fact changes the project map above, update the map instead.
- At the start of a task, if `/memories/repo/progress.md` exists and relates to the task, read it and continue from it.

## Self-checkpointing and compaction
- Checkpoint on your own, without waiting to be asked, after any major change:
  - a feature or milestone is finished and verified
  - a schema, API, or data-model change
  - an Advisor verdict that changes direction
  - you've edited 4 or more files since the last checkpoint
  - right before starting a big new phase

  To checkpoint, read `.github/prompts/checkpoint.prompt.md` and follow its steps, but skip its final reply line. Don't checkpoint after small edits.
- You can't run `/compact` yourself. When you've just checkpointed and the next step doesn't need the earlier file contents or tool output from this chat, end your reply with: `Progress saved. Safe to /compact.` Otherwise don't suggest it.
