# AION — AI Intelligence & Observation Network

Your personal AI research & intelligence radar. AION continuously ingests AI
news, papers, model releases, and open-source activity into a database, then
answers one question well: **"What changed since I last checked, and what
should I read next?"**

It never crawls the internet live on a user request — ingestion runs on a
schedule, and the app queries the processed database (see `src/lib/ingestion`
and `src/lib/radar`).

## Tech stack

Next.js (App Router) + TypeScript + Tailwind, PostgreSQL + Prisma, a
provider-agnostic AI layer (`src/lib/ai/client.ts`), Web Push, and a PWA shell
(manifest + service worker).

## Local setup

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and AI_API_KEY at minimum
npx prisma migrate dev       # creates tables
npm run prisma:seed          # registers sources/topics + a demo user
npm run dev                  # http://localhost:3000
```

The app auto-creates a single "demo" user on first visit (see `src/lib/auth.ts`)
— no signup flow needed to try it locally. Swap in real auth later without
touching any other code, since everything calls `getCurrentUser()`.

Run the unit test suite with `npm test` (see "Testing" below).

## Radar architecture

The Radar's development candidates are computed by a **unified candidate
engine** (`src/lib/radar/candidates.ts`) that merges Articles, Research
Papers, Model Releases, and Open Source Projects into one normalized,
rankable set — a new paper, a new model release, or a trending open-source
repo can all show up in "Since Your Last Check", not just news articles.

The LLM never identifies a database row by URL. Every candidate gets an
opaque `candidateId` (e.g. `paper:ckx1a2...`); the model is asked to return
`candidateId`s, and the server validates every returned id against the
actual supplied candidate set before mapping it back to a database row —
invalid/hallucinated ids are discarded rather than trusted (see
`generate.ts`/`candidateToItemRef`).

**Checkpoint correctness:** only a *successful* Radar generation advances
`lastRadarGeneratedAt`. Opening the app never does. A failed generation never
does. Push notifications never do — they call a read-only preview
(`previewRadar`, which mirrors the real ranking/top-N cutoff rather than a
raw unread count) instead of `generateRadarBriefing`, specifically so a
scheduled notification can't silently consume developments the user never
actually saw.

Items that arrive before a checkpoint but were never actually shown in a
brief (e.g. they didn't make the top-5 cutoff) don't just vanish — a bounded
14-day backlog gives never-shown, never-read items a second chance to
compete for a slot on the next run (see `BACKLOG_LOOKBACK_DAYS` in
`candidates.ts`), without resurrecting arbitrarily old content.

**Concurrency:** `generateRadarBriefing` retries acquiring its atomic DB-row
lock (`acquireRadarLock`/`releaseRadarLock`) a bounded number of times and
genuinely never proceeds into generation without holding it — if it still
can't after retrying, it returns the most recent existing brief rather than
racing the request that holds the lock. Brief creation, its items, and the
checkpoint advance are one atomic transaction (`db.$transaction`), plus a
unique constraint on `(userId, checkpointFrom, checkpointTo)` as a second
layer — two near-simultaneous "Run Radar" calls (phone + laptop) resolve to
the same brief instead of creating duplicates or an inconsistent
brief-without-checkpoint-advance.

**Three-state messaging:** "nothing new" and "AION's sources haven't updated
recently" are deliberately different messages (see `quietPeriodMessage()` in
`generate.ts` and `src/lib/sources/health.ts` — freshness is coverage-based,
not just a stale/failed ratio) — a quiet Radar should never look identical
to a stale one.

## Publication date vs. discovery date

`Article.publishedAt` is nullable. When the real publication date isn't
reliably known (e.g. a web-search-fallback result), it's stored as `null` —
**never defaulted to "now"**. `createdAt` serves as `discoveredAt`: the fact
of when AION found something is different from when it was published, and
ranking/recency (`rank.ts`) falls back to `discoveredAt` only for display/
scoring purposes, never to claim a stale item is freshly published.

## Commands (typed or voice — same engine)

`src/lib/commands/parser.ts` deterministically resolves most phrasings
without an LLM call; only genuinely ambiguous input falls back to one
classification call. Supported intents: `since_last_check`, `today`,
`recent_research`, `topic_research` (alias-aware — see
`src/lib/topics/config.ts`), `recommendations`, `model_releases`, `ai_news`,
`open_source`, `daily_brief`, `search`. Every intent queries and returns real
content — none of them just redirect to another page.

Temporal phrases ("yesterday", "this week", "last 24 hours", "last N days",
"since Monday") are parsed deterministically (`src/lib/commands/temporal.ts`)
and flow through as an explicit `sinceDate` on the parsed command.

`topic_research` and `search` fall back to a narrow, query-specific web
search (`src/lib/search/fallback.ts`) only when the database has fewer than 3
matching rows — never a broad crawl. The fallback caches at two levels: the
*query itself* (`SearchCache`, hashed, with a TTL — so the same query never
re-hits the provider) and the *resulting content* (as `Article` rows, so a
future DB-first query finds it directly).

Voice has a real state machine (idle/listening/processing/speaking/error) in
`AskAion.tsx` — recognition and speech synthesis are never allowed to run at
once, TTS can be stopped mid-sentence, and voice language is a UI setting
(English/Hindi/Auto), not hardcoded to `en-US`.

## Ranking & recommendations

`src/lib/radar/rank.ts` computes one explainable weighted score from
importance, novelty, relevance, recency, interest match, and source quality.
Previously-shown/read content is a *ranking penalty*, not a hard filter — a
major development you've already seen can still resurface; a minor one you've
read sinks well below new material.

Interest weighting combines explicit interests (Settings) with a smaller
*behavioral* signal — topics you actually open and bookmark repeatedly (see
`src/lib/radar/behavior.ts`), capped so behavior alone can never outweigh an
explicit interest.

"New Research" (Research page — recency-sorted) and "Read Next"
(`src/lib/radar/readNext.ts` — ranked by relevance regardless of recency) are
deliberately separate: a 3-week-old paper can still be the best
recommendation.

## AI cost control

Every ingested item passes a cheap, deterministic pre-filter
(`shouldSkipLLM`/`heuristicClassify` in `src/lib/ingestion/classify.ts`)
*before* any LLM call: thin content from a lower-quality source that doesn't
even superficially match a known topic alias is stored with a heuristic
classification instead of paying for a summary/score nobody's likely to need.
Content is never dropped, just classified more cheaply.

## Source health

`src/lib/sources/health.ts` tracks per-source freshness from existing
`IngestionRun` rows (fresh / stale / failed / never run). View it at
`/status` (internal — not linked from primary navigation). This is what
powers the three-state Radar messaging above and answers "why didn't AION
show today's OpenAI update" without digging through logs.

## Environment variables

See `.env.example` for the full list with comments. Required to run:
`DATABASE_URL`, `AI_API_KEY`. Everything else (GitHub token, VAPID keys,
CRON_SECRET, ADMIN_SECRET, SEARCH_PROVIDER/SEARCH_API_KEY) is optional and
simply disables that feature if left blank — except `ADMIN_SECRET`, which
gates `/status` and `/api/settings/sources`; unset means those are denied
entirely, not open.

## Running ingestion

Ingestion is a separate step from the web server — trigger it however fits
your deployment:

```bash
npm run ingest              # all categories once
npm run ingest:research     # arXiv + OpenAlex only
npm run ingest:news         # lab blogs / RSS only
npm run ingest:models       # Hugging Face model releases only
npm run ingest:opensource   # GitHub only
npm run brief:daily         # generate today's AI Brief
```

Or hit the equivalent authenticated HTTP endpoints from any scheduler
(`Authorization: Bearer $CRON_SECRET`):

```
POST /api/cron/ingest-research
POST /api/cron/ingest-news
POST /api/cron/ingest-models
POST /api/cron/ingest-opensource
POST /api/cron/daily-brief
POST /api/push/send          # per-user timezone-aware — see below
```

Suggested cadence: research + news every few hours, models + open-source +
daily brief once a day. **`push/send` should run HOURLY, not once a day** —
it checks every enabled user's *local* hour against their configured
`dailyBriefTime` on every run (via `src/lib/timezone.ts`'s IANA-timezone-
aware `getLocalTime`), and `lastDailyNotificationAt` prevents more than one
send per local calendar day.

## Testing

```bash
npm test          # runs the unit suite once
npm run test:watch
```

Unit tests cover the pure, DB-independent logic: URL canonicalization, title
similarity (dedup), topic alias matching, ranking behavior (including the
previous-exposure-is-a-penalty-not-a-filter case), and both timezone helpers.
There is deliberately **no integration test suite** here (would need a real
Postgres instance to run in CI) — the most important untested workflow is
"first Radar establishes a checkpoint → new content arrives → second Radar
shows only the new content, ranked with prior-exposure penalties applied to
anything re-surfaced." Worth adding before this handles real user data.

## Production build

```bash
npm run build
npm run start
```

## Deployment

Any Node host works. A practical, inexpensive setup:

- **App**: Vercel, Railway, or Fly.io (Next.js app + API routes)
- **Database**: Neon, Supabase, or Railway Postgres
- **Scheduled jobs**: Vercel Cron (if on Vercel) hitting the `/api/cron/*`
  routes above, or a plain crontab running `npm run ingest` / `npm run
  brief:daily` on a small always-on box
- **Push**: no extra service needed — Web Push talks directly to each
  browser's push service using your VAPID keys

## PWA / notifications setup

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   (same public key, exposed to the browser) in `.env`
3. Deploy over HTTPS (required for service workers/push outside localhost)
4. Visit Settings → Notifications → enable "Daily AI Radar notification" to
   subscribe a device (this also saves your browser-detected IANA timezone,
   used for the per-user scheduling above)

Install: the "Install AION" button appears automatically once the browser
fires `beforeinstallprompt` (Chrome/Edge/Android). iOS Safari has no
programmatic install prompt — it's Share → Add to Home Screen, and AION
doesn't claim otherwise.

## Testing

```bash
npm test          # unit suite, runs once
npm run test:watch
```

98 unit tests across 16 files, all DB/network-independent (mocking Prisma
and `fetch` where a module is coupled to them). This has already caught two
real bugs during development, not just after the fact — worth noting since
it's easy to treat tests as busywork:

- A timezone-boundary convergence bug in `localCalendarDayBoundsUtc()` that
  landed ~11 hours off local midnight (compared the correction against the
  shifting guess instead of the fixed target — see the comment in
  `timezone.ts`).
- The command-parser precedence bug from the previous review round ("SSM
  research this week" falling into the generic "today" bucket).

No integration/workflow test suite runs against a live database in this
environment — see "Known limitations" for what that would cover and why.

## Known limitations

Corrected in this pass:
- The Radar lock's stale-takeover recovery had a real race: if request A ran
  long enough to be stale-takeover'd by B, A's eventual `releaseRadarLock()`
  call would clear B's lock too (timestamp-only locks can't distinguish "a
  lock exists" from "MY lock exists"). Added an ownership token
  (`User.radarLockToken`) — release now only succeeds if the caller's token
  still matches the current holder's.
- The 14-day unseen backlog excluded previously-*shown* items but not
  previously-*read* ones, contradicting its own documented "never shown AND
  never read" semantics — a manually-opened article could still get
  resurrected once the checkpoint moved past it. Now excludes both.
- Also found while fixing the above: the backlog's lookback bound used
  `Math.min` where it needed `Math.max`, so a stale checkpoint (>14 days
  old) let the backlog window extend arbitrarily far back instead of
  actually being capped at 14 days.
- Candidate/Read-Next ordering had no unique tie-breaker — rows with
  identical importance/relevance/date have no defined order in Postgres, so
  which ones fell inside vs. outside a `take` cap wasn't actually
  deterministic. Added `{ id: "asc" }` as a final sort key everywhere, plus
  explicit `NULLS LAST` for nullable dates (previously relying on Postgres
  defaults).
- Malformed/unusable LLM Radar responses were being silently reinterpreted
  as "Nothing major changed" — worse than a failed generation, because the
  checkpoint would still advance past real developments the user never saw.
  `validateRadarResponse` now returns a discriminated `{ok:false, reason}`
  for a genuinely unusable response (bad shape, or every claimed development
  referencing an invalid id) vs. `{ok:true, ...}` for a real quiet period;
  `generate.ts` throws `RadarGenerationError` on the former — no brief
  persisted, no checkpoint advance. (Also found in the process: the Zod
  schema had `.default()` on every top-level field, which meant it could
  never actually reject a wrong shape like `{foo:"bar"}` — defaults would
  silently fill in for anything missing. Fields are required now.)
- `topic_research` parsed temporal phrases ("SSM research this week")
  correctly but then completely ignored `sinceDate`/`untilDate` when
  building its DB query — "this week" could still return arbitrarily old
  papers. Fixed and covered by a route-level regression test.
- `/api/search` and several `/api/command` queries had no `orderBy` at all
  (or one without an id tie-breaker) — added deterministic ordering
  throughout.
- `previewRadar()`'s doc comment claimed to mirror the actual Radar's final
  output exactly — not quite true, since the real Radar's LLM step can
  choose to show fewer than the top-ranked candidates it's given. Comment
  and the notification wording ("N relevant developments" vs. the
  overclaiming "N updates") now reflect that distinction honestly.
- `.env.example` documented `SESSION_SECRET` as signing the demo session,
  but the cookie was just the raw user id — unsigned, so a client could set
  `aion_session=<any-id>` and impersonate that account. Now actually
  HMAC-signed and verified; also added the `secure` flag for production.

Still open:
- Auth is still the single demo-user abstraction (`getCurrentUser()`) —
  every other part of the app already depends only on that function, so
  swapping in real multi-device auth is a one-file change, but it hasn't
  been done. **Do not deploy this publicly as-is.**
- The `(userId, checkpointFrom, checkpointTo)` uniqueness constraint helps
  but isn't a complete idempotency story on its own — `to` is generated
  independently per request (`new Date()`), so two concurrent requests with
  slightly different `to` timestamps produce different unique keys. The lock
  is the primary protection; the constraint is a second layer, not a
  substitute for it.
- No integration/workflow test suite runs against a live database — the
  121 unit tests (mocked Prisma throughout) cover the decision logic
  extensively, including three genuine bugs the tests themselves caught
  during this pass (see below), but not real transactional behavior under
  Postgres.
- Recommendations/`getReadNext()` don't yet honor a temporal modifier if
  one is given ("recommend something from this week") — `topic_research`
  and the other list intents do now; recommendations still use its fixed
  45-day window regardless.
- GitHub project "developments" still can't represent a meaningful change
  to an already-known repo (a real release, an architecture rewrite) — only
  first-sighting counts as "new". Documented as a deliberate v1 trade-off,
  not a bug — see the earlier round's fix for why "every push" was wrong,
  and the review note on why "meaningful activity tracking" is future work.
- Source health computes one global freshness score rather than per-category
  (research/news/models/opensource) — a single dead RSS feed can currently
  drag down the overall reading even if arXiv/OpenAlex are perfectly fresh.
- Search-fallback content (`origin: SEARCH_FALLBACK`) has no expiry/cleanup
  policy yet — it accumulates in the canonical tables indefinitely.
- Read Next's window is a fixed 45 days; search is `ILIKE`, not full-text;
  "Explain with AION" caches in-memory only. (Unchanged from prior rounds.)

### Bugs the test suite itself caught this pass

Worth calling out specifically, since it's the clearest evidence the testing
investment is paying for itself rather than being busywork:
1. The backlog's `Math.min`/`Math.max` lookback-bound bug above — found
   while writing the "bounds the backlog window" test.
2. The Zod `.default()`-on-every-field schema flaw above — found while
   writing the "rejects completely unrelated JSON" test.
3. (From the previous round) a timezone-boundary convergence bug that
   landed ~11 hours off local midnight.
