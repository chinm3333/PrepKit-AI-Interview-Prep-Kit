# PrepKit | AI Interview Prep Kit

Turn a job description + company website + days-until-interview into a structured, editable interview preparation kit.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js 15 + Tailwind CSS | Preferred stack; App Router for kit builder UX |
| Backend | Node.js + Express | Preferred stack; clear REST boundary for long-running generation |
| Database | MongoDB | Preferred stack; flexible kit documents |
| Language | TypeScript | Safer shared kit schema across API + CLI |
| Scraping | `fetch` + Cheerio + robots-parser | Lightweight, respects robots.txt, follows relative links (incl. localhost fixtures) |
| LLM | **Groq** (`openai/gpt-oss-120b`) primary, **Gemini** backup | Groq OpenAI-compatible model; automatic failover to Gemini on rate limits / outages |

Monorepo workspaces:

- `packages/pipeline` | retrieval, generation, coverage, schedule, validation, **and** `npm run evaluate`
- `apps/api` | auth, kit CRUD, generation jobs
- `apps/web` | UI

The batch CLI and the HTTP API call the **same** `generateKit()` function.

## Setup (local)

### Prerequisites

- Node.js 18+
- MongoDB running locally (or a free Atlas URI)
- A free Groq API key from https://console.groq.com/keys
- Optional backup: Gemini key from https://aistudio.google.com/apikey

### Install

```bash
cp .env.example .env
npm install
```

### Run

```bash
npm run dev:api

npm run dev:web
```

Or both: `npm run dev`

Open http://localhost:3000 | register, create a kit, watch progress.

### Batch entry point (Section 9)

```bash
npm run evaluate -- --input ./samples/cases.json --output ./kits.json
```

### Tests

```bash
npm test
```

Covers schedule allocation, coverage checking, kit structure validation, repair, grounding, SSRF helpers, and pin-preservation filters.

## Architecture

```
JD + company URL + days
        │
        ▼
┌───────────────────┐
│  extractRoleFromJd │  LLM | requirements only from JD text
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ crawlCompanySite   │  deterministic crawl/rank/fetch (not hardcoded /careers)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ public discussion  │  DuckDuckGo HTML search + optional page fetches
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ company brief      │  LLM | grounded in fetched pages only
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ questions / category│ separate LLM calls: technical, behavioural,
│                     │ system-design, company-fit
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ coverage check     │  CODE | must-have ids without questions
│ gap fill (loop)    │  LLM only generates missing questions
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ flashcards         │  LLM
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ allocateSchedule   │  CODE | arithmetic across exactly N days
└───────────────────┘
```

## Retrieval approach & sources

1. Fetch the company URL (validate scheme; block private/loopback in production unless `ALLOW_PRIVATE_URLS=true` for local evaluate fixtures).
2. Parse `robots.txt` and skip disallowed paths.
3. Extract same-origin links; **score** by URL/anchor signals (careers, hiring, handbook, about, blog…).
4. Fetch top-ranked pages (rate-limited, size/content-type capped). One extra hop for strong hiring candidates.
5. Public discussion: DuckDuckGo HTML search for “{company} interview process experience”, optionally fetch a couple of matching result hosts (Glassdoor/Blind/Reddit/etc. when present).
6. Unreachable sources are **skipped and recorded**, not fatal.

Untrusted page/JD text is wrapped and instruction-like patterns filtered before LLM calls.

## Coverage passes

Default **max 2 passes**. After the first question draft, code computes uncovered must-have requirement ids. The model generates only gap questions; code checks again. Two passes balance free-tier latency against “every must-have has a question.” If gaps remain (e.g. model failure), they are reported honestly in `coverage.uncovered_requirement_ids`.

## Generated / edited / pinned state

Persisted on the kit document as `meta`:

| Origin | Meaning |
| --- | --- |
| `generated` | Produced by the pipeline |
| `edited` | User changed text (auto-pinned on edit) |
| `user` | Added manually |

`pinnedQuestionIds` / `pinnedFlashcardIds` survive category regeneration. Regenerating a question category keeps pinned + edited + user questions in that category and only replaces pure `generated` ones. Company brief / schedule regeneration does not touch questions or flashcards.

## Schedule allocation

Deterministic in `allocateSchedule`:

- Clamp days to 1–60
- Score questions by difficulty, must-have coverage, category priority
- Place harder / must material earlier
- Ensure every must-have that has a question appears in the schedule
- Rebalance empty days; minutes are integer sums of per-question estimates

## Practice mode

Confidence-weighted queue: unseen cards first, then lowest confidence (1–5), then oldest `lastSeenAt`. Simple, predictable, and good for a short prep window | full SM-2 spaced repetition is optional later.

## Creative feature

**Weak spots workflow** (kit tab + banner):
- Lists uncovered must-haves, unseen/low-confidence flashcards, and difficulty-3 questions
- Banner treats unseen cards as needing attention
- Deep-links into practice with `?focus=<flashcardId>` so the weakest card leads
- **Generate missing questions** uses the same coverage gap-fill path as the second pass

## Edge cases

| Case | Behaviour |
| --- | --- |
| Bad/404/timeout company URL | Crawl skip; honest thin brief; kit still `ok` if generation can proceed from JD |
| No hiring/about page | Noted in progress; questions lean on JD only |
| Two-line JD | Thin extraction; few requirements; no invention |
| No public discussion | Step skipped |
| Invalid LLM JSON | Retry with backoff; fail case only if unrecoverable |
| Rate limits | Exponential backoff + jitter (pipeline + LLM client) |
| Duplicate JD+URL+days | API returns existing kit (`deduped: true`) |
| 1-day / 60-day | Schedule length matches exactly (clamped) |

## Security

- URL allowlist (`http`/`https`); private IPs blocked when `NODE_ENV=production` and `ALLOW_PRIVATE_URLS` is not true
- DNS resolution checked before fetch; redirects followed manually with re-validation each hop (SSRF defense)
- Content-type + max byte limits on fetches
- Fetched/pasted text treated as data, never instructions; requirements grounded against JD text in code
- Session JWT in httpOnly cookie + Bearer token for the SPA
- Users can only read/write their own kits

## Design decisions & limitations

- **Shared pipeline package** so evaluate cannot drift from the app.
- **Groq primary + Gemini backup**: each call tries Groq first, then Gemini on rate limits / errors. Category calls are serial with backoff so five evaluate cases stay within 15 minutes.
- **In-process generation jobs** (not a queue worker) | fine for the assessment; a Redis/Bull worker would be better in production for multi-instance deploys.
- Public discussion via DuckDuckGo HTML is best-effort and may be empty or blocked.
- Deployment / GitHub push are left to you.

## Environment variables

See `.env.example` for every variable and what it does.

### DEMO
([PrepKit Demo](https://www.loom.com/share/411687f654fc431d834f6a0c4f2acd91))[https://www.loom.com/share/411687f654fc431d834f6a0c4f2acd91]

### LIVE
([Prepkit live](https://prepkit-two.vercel.app/kits/6aa4677106d2a873bfccf80b))[https://prepkit-two.vercel.app/kits/6aa4677106d2a873bfccf80b]
