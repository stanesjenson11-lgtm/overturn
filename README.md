# Overturn

**Your health insurance claim was rejected. Does the reason hold up?**

Upload the policy wording and the insurer's rejection letter. An agent checks
the stated reason against your policy and against IRDAI's own rules, runs the
date checks in plain code, asks you only for the facts the documents don't
hold, and gives a verdict (likely challengeable, the rejection looks valid, or
needs more information) with every point cited to a clause. When the rejection
doesn't stand, it hands you the appeal letter.

When the rejection *is* sound, it says so. The headline metric is the
**false-hope rate**: how often it calls a valid rejection worth fighting.

[![ci](https://github.com/OWNER/overturn/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## Why this problem

- Indian insurers rejected roughly **₹30,000 crore** of health claims in FY25,
  about 15% more than the year before, according to coverage of the IRDAI
  Annual Report 2024-25.
- Complaints on IRDAI's Bima Bharosa portal rose from 47,658 (FY24) to 64,365
  (FY25), and passed 73,000 by February FY26.
- IRDAI collects claim repudiation rates but **not the reasons**. The one hard
  requirement is on the letter itself: a rejection must give "full details
  giving reference to the specific terms and conditions of the policy
  document" (Master Circular on Health Insurance Business, 29.05.2024, §17(b)).
- That requirement is exactly what cited retrieval can check. A rejection
  names a clause; the policy and the regulations say what that clause is
  allowed to do.

## The demo worth watching

The seeded case is a rejection for non-disclosure of hypertension, citing the
policy's pre-existing-disease clause.

1. **Review this rejection.** The agent reads the letter, finds the clause, and
   finds the moratorium. Then it stops and asks one question: *when did your
   cover first start?* Neither document says, and the answer decides the case.
2. **Answer: 1 March 2019.** The rule check counts **79 months** of continuous
   cover at admission. Past sixty, a claim can't be contested for
   non-disclosure, only for established fraud, which the letter doesn't allege.
   Verdict: **likely challengeable**, citing the policy's own moratorium clause
   (a `[P]` chip) and the regulation behind it, Schedule III §8 of the
   Insurance Products Regulations (an `[R]` chip).
3. **Download the appeal letter.** It's addressed to the insurer's grievance
   officer, quotes each clause it relies on, and comes with a second page of
   dates: when you can go to the Insurance Ombudsman (one month without a
   reply) and the deadline (one year).

---

## Architecture

```
 Case = one rejected claim
 ┌───────────────────────────────┐
 │ policy wording   ──┐          │       ┌──────────────────────────────┐
 │ rejection letter ──┼─ ingest ─┼──────►│ chunks (tenant-scoped)        │
 │ discharge summary ─┘ (scans   │       │ pgvector + tsvector           │
 │                      read by  │       └──────────────────────────────┘
 │                      Flash-   │       ┌──────────────────────────────┐
 │                      Lite)    │       │ reg_chunks (public)           │
 └───────────────────────────────┘       │ IRDAI circular + regulations, │
                                          │ Ombudsman Rules: 287 clauses  │
 Agent (bounded tool loop)                └──────────────────────────────┘
   search_policy      ── hybrid RRF + rerank over the case's documents  → P1, P2…
   search_regulations ── the same over IRDAI's text                     → R1, R2…
   check_rules        ── plain functions: moratorium, waiting periods,
                         renewal grace, the letter's duty to cite a clause…
   ask_questionnaire  ── a form, for facts no document holds (exits the loop)
   record_verdict     ── challengeable / valid / needs_info + cited grounds
        │
        ├─► SSE to the case page: each tool step live, then the verdict
        ├─► appeal letter PDF, assembled from the verdict (no model call)
        └─► MCP server (list_cases, review_case) and the eval: same generator
```

One Next.js app on Vercel, Neon Postgres with pgvector, Google AI Studio for
every model call.

### Why the rules aren't the model's job

The model never does date arithmetic. Whether 2019-03-01 to 2025-10-02 is past
sixty months, whether a renewal paid 24 days late broke continuity: those are
[plain functions](lib/rules.ts) with [tests](tests/rules.test.ts). Each one
names the provision it encodes, and each was read in the **primary text**, not
in a blog. That reading corrected two widely repeated claims:

- The 36-month cap on pre-existing-disease waiting periods is in the **IRDAI
  (Insurance Products) Regulations, 2024**, Schedule III §7, not in the Master
  Circular that most summaries attribute it to.
- The Ombudsman Rules don't give the insurer fifteen days. A complaint can be
  made once the insurer has rejected your written representation, or hasn't
  replied **within one month**, and within one year after that (rule 14(3)).

Results are three-valued. A check that lacks a fact returns `null` and names
the fact, and the agent asks the user for it instead of assuming.

### Two corpora, one boundary

The user's documents are tenant data, filtered by `user_id` in every statement.
IRDAI's text is public: it sits in its own table with no tenant, is written
only by `npm run ingest-regulations`, and is read through `raw()` with a comment
saying why. Policy passages are labelled `P1…` and regulations `R1…`, so an
appeal reads "your policy says" and "the regulator says" differently. A cite to
an id the model was never handed is dropped before anyone sees it.

### The agent, and what it doesn't trust

Ported from a product-advisor agent's loop: tools that never throw (a bad
argument becomes an error the model can recover from), a hard step cap, and a
questionnaire tool that hands control back to the user. One deliberate change:
**history is server-held**. The browser sends a question and nothing else, so a
tool result can never be forged from the client. The model is told that
document text is data, and the eval includes a rejection letter carrying a
prompt injection.

Three more constraints, each added because an eval run caught the failure it
prevents:

- **A review must end in a decision.** In review mode the model is in
  function-calling mode `ANY`, so it finishes with `record_verdict` or
  `ask_questionnaire`, never with a conclusion buried in prose.
- **It's briefed before it reasons.** A review opens with the whole rejection
  letter and the IRDAI rules that govern its stated reason, plus anything
  checkable in code (does the letter cite a clause?). Before this, it reached
  correct verdicts without ever citing the regulator.
- **Its tool inputs are grounded.** A date passed to `check_rules` must have
  been stated by the policyholder or appear in the documents; `01/03/2019` and
  "March 2019" count, a bare year doesn't. It once inferred a start date from
  the year in a policy number. Now that's refused, and it asks instead.

### The appeal letter has no model call

By the time there's a verdict, everything the letter needs is verified: the
grounds came from `record_verdict`, each one quotes exactly the passages it
cited, the claim details are the letter's grounded facts, and the dates come
from the rules engine. Drafting with a model would be the one step that could
invent something; [the template](lib/letter.ts) can't. Personal details it
doesn't have stay as visible `[placeholders]`.

---

## Evaluation

`npm run eval` reviews 16 synthetic rejection letters against one synthetic
policy ([eval/cases.jsonl](eval/cases.jsonl)): 8 that should be challengeable,
7 that should be valid (one carrying a prompt injection), and 1 that should
make the agent ask. It writes `eval/results.md`.

| Metric | Latest run (2026-10-05) | Notes |
| --- | --- | --- |
| Verdict accuracy | **16/16** | single run; earlier runs scored 11–14/16 (see below) |
| False-hope rate | **0 of 7** | valid rejections called challengeable: 0 in every run |
| Missed-rights rate | **0 of 8** | challengeable rejections called valid: 0 in every run |
| Citation validity | **100%** | every `[P]`/`[R]` opens onto a passage the agent was given |
| Cites the regulator | **88%** | challengeable verdicts backed by an IRDAI passage |
| Groundedness | **91%** | LLM-as-judge (Gemma 4 31B), 10 of 11 judged; 5 not judged (judge 503/500) |
| Key-terms accuracy | **13/13** | policy terms and letter facts, extracted and grounded |
| Median review | 33s, 4 tool calls | free tier |

**How it got there.** Each run's failures were traced and fixed in general,
never per case, and every miss along the way was in the safe direction (asking,
or declining to decide, never false hope):

| Run | Verdicts | What the failures were | The general fix |
| --- | --- | --- | --- |
| 1 | 11/16 | concluded in prose without recording a verdict; asked for facts the user had given; no rule for the initial wait | a review must end in a tool call (function-calling mode `ANY`); stated facts are rule inputs; an `initial_waiting` rule |
| 2 | 14/16 | correct, but **0%** of verdicts cited IRDAI; it decided from the policy in three steps | a review opens with a briefing: the whole letter and the governing regulations, retrieved before the first call |
| 3 | 12/16 | inferred a start date from the year in a policy number, then counted months itself | **rule inputs are grounded**: a date must be stated by the user or appear in the documents, or `check_rules` refuses it |
| 4 | 16/16 | none | |

Sixteen cases on a free tier is a small, noisy sample: treat 16/16 as "the
known failure modes are closed", not as a precision estimate.

- **False-hope rate**: valid rejections called challengeable. The number this
  project exists to keep low.
- **Missed-rights rate**: challengeable rejections called valid.
- **Citation validity**: every `[P]`/`[R]` opens onto a passage the agent was
  actually given.
- **Cites the regulator**: challengeable verdicts backed by an IRDAI passage,
  not only the policy's own wording.

The cases are checked offline in CI ([tests/golden.test.ts](tests/golden.test.ts)):
renderable, balanced enough to measure, and wherever a rule decides a case,
labelled the way the rules engine decides it. A mislabelled case would
otherwise score the agent wrong forever. A run where any call never reached the
model is voided rather than scored: on the free tier, an outage scored as a
wrong answer is a fake number.

### Reading scans: Gemma 4 vs Gemini

Rejection letters usually arrive as scans. `npm run scan-bench` renders each
fixture as a seeded scan (rasterised, tilted, speckled, saved as JPEG inside
an image-only PDF) and has each model read it through the production path.

| Model | Mean CER | Letter facts kept | Median per document | Failed |
| --- | --- | --- | --- | --- |
| `gemini-3.1-flash-lite` | **0.13%** | 6/7 | **12.8s** | none |
| `gemma-4-31b-it` | **0.12%** | (didn't finish) | 53.6s | 1 of 4 (server 500) |
| `gemma-4-26b-a4b-it` | 12.42% | 3/7 | 9.2s | 3 of 4 (no answer within 5 min) |
| `gemini-3.7-flash` | (not run) | | | 20 requests a day on the free tier |

**Gemma 4 31B reads scans as accurately as Gemini Flash-Lite, but takes four
times as long, and was less reliable on the free API.** A 15-page scan has to
finish inside one upload, so Flash-Lite is the default. The first run of this
benchmark also found that `gemini-3.7-flash` allows 20 requests a day per
project, which ruled it out as a scan reader for a public app before quality
came into it (and moved the eval's judge to Gemma 4 31B, where latency doesn't
matter).

A spike settled the plumbing first: Gemma 4 on the Gemini API reads an
image-only PDF directly and accepts a system instruction and JSON mode, so the
scan path just takes a model name. Four documents is a small sample; the
script is there to re-run when Gemma's free-API latency changes.

---

## Multi-tenancy

The governing rule: **the authenticated identity determines the tenant; request
ids only select resources within that tenant.** Never the other way round.

1. **`session()`** ([lib/auth/session.ts](lib/auth/session.ts)) is the only place
   a user identity enters the system.
2. **`tq()`** ([lib/db/client.ts](lib/db/client.ts)) refuses at runtime to run any
   statement touching a tenant table without a `user_id` predicate.
3. **`tests/tenant-guard.test.ts`** applies the same rule to
   `lib/db/queries.ts` **as source text**, with its own negative control.

[`tests/isolation.test.ts`](tests/isolation.test.ts) is a list of distinct
cross-tenant attacks, all expecting **404, not 403**. A 403 would confirm the
resource exists. Two came with multi-document cases: filing a document into
someone else's case (the case id arrives in the upload form), and smuggling
someone else's document id into a search alongside your own.

---

## Running it

```bash
cp .env.example .env.local     # DATABASE_URL, SESSION_SECRET, GOOGLE_API_KEY
npm install
npm run migrate                # idempotent
npm run ingest-regulations     # downloads IRDAI's PDFs into corpus/, ~3 min on the free tier
npm run seed                   # the demo case: a synthetic policy and rejection letter
npm run dev
```

| Command | |
| --- | --- |
| `npm test` | 160 tests, no external services (Postgres runs in-process via PGlite) |
| `npm run eval` | the 16 cases → `eval/results.md` (free tier; several minutes) |
| `npm run scan-bench` | Gemma 4 vs Gemini on seeded scans → `eval/scan-results.md` |
| `npm run ingest-regulations` | re-run after IRDAI revises a document; it replaces, never duplicates |
| `npm run mcp -- <email>` | stdio MCP server with `list_cases` and `review_case` |

### Use it from Claude (MCP)

```json
{
  "mcpServers": {
    "overturn": {
      "command": "npm",
      "args": ["run", "--silent", "--prefix", "/path/to/overturn", "mcp", "--", "you@example.com"]
    }
  }
}
```

It runs as the named account, the same trust model as the eval: whoever can
start it already holds `DATABASE_URL`. Daily caps apply.

## Deploying

1. **Neon**: a database (a separate one from any other app; the schemas
   differ). Use the pooled connection string.
2. **Google AI Studio**: an API key. The free tier is enough for a demo, with
   its limits: 5 requests a minute on the answer model, 100 embedded texts a
   minute (`embed()` paces itself under that).
3. **Vercel**: import the repo and set `DATABASE_URL`, `SESSION_SECRET`,
   `GOOGLE_API_KEY`.
4. **GitHub** secrets for CI's deploy step and the nightly eval.
5. `npm run migrate && npm run ingest-regulations && npm run seed` once against
   production, and `npm run migrate` again **before** pushing any change to
   `schema.sql`: CI deploys code, not schema.

---

## Decisions and trade-offs

- **The agent runs on the lite model.** One review spends four to six calls,
  and the free tier allows the answer model five a minute. The legal reasoning
  is carried by the rules engine and the retrieved text; the eval measures
  whether that holds.
- **Tool steps stream; the verdict arrives whole.** Watching "checking IRDAI's
  rules" is the useful part; a verdict half-streamed before its last tool call
  would be a guess.
- **One document of each kind per case**, enforced by a database constraint
  rather than a route, so two uploads in flight can't race past it.
- **Regulations are public and shared**; only a script writes them.
- **Not legal advice.** It reads your documents and IRDAI's rules. It does not
  know case law, your insurer's practice, or facts you haven't given it.

**Built on [LeaseLens](https://github.com/OWNER/leaselens)**: the auth, tenant
isolation, ingestion and hybrid retrieval came from there. Overturn replaced
its fixed answer pipeline with the agent; that pipeline's rewrite, grade and
off-topic gate became decisions the agent makes itself.

---

*Information from your documents and IRDAI's rules, not legal or medical advice.*
