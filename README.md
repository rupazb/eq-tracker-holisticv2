# GIS Project Services — Status Tracker (v2)

A one-stop replacement for the current Excel workbook. Everyone logs their
status through one form; that write lands directly in a Google Sheet;
every dashboard view — daily, weekly, bandwidth, risk — is computed live
from that same sheet, matching the views in your latest workbook (View 1 /
View 2 / View 3 / Control Mapping). Nobody hand-copies rows between tabs.

## What's in v2

Your updated workbook added three dashboard views and some new
workstreams. Here's how each maps onto this system:

| Your workbook | This tool | Where |
|---|---|---|
| View 1 — Daily update | The Log sheet + Log Update form | Same as v1, unchanged |
| View 2 — Weekly update | **Weekly** panel | Planned / Executed / Carry-over are auto-computed from the Log. Wins / Priorities / Help needed / Reasons for spillover are judgment calls, so they're captured through a short once-a-week note form (not derivable from daily logs) |
| View 3 — Weekly Time Estimate | **Bandwidth** panel | Per-person hours by workstream, computed from the `Actual Hours` field already in the daily form, against a 40hr/week capacity |
| Control Mapping | **Risk** panel | Static reference table — workstream complexity/visibility ratings, editable directly in the Risk sheet |
| New workstreams (WS1, WS3, Peer Review QA) | Added to Config seed | Already in the dropdowns |

## How it works

```
 Anyone on the team          Google Sheet                    This page
 fills out the daily   --->  Log (source of truth)    --->   Insights:
 form (index.html)           + Config (dropdowns)             Overview / Weekly /
                              + WeeklyNotes (weekly notes)     Bandwidth / Risk —
                              + Risk (static register)         all computed live
```

- `apps-script.gs` — backend. Deployed as a Google Apps Script Web App.
  Handles form submissions (`doPost`, both daily entries and weekly notes)
  and serves every dashboard view as JSON (`doGet`).
- `index.html` — the entire frontend, **self-contained** (all JS inlined,
  no external `<script src>` files to load). Open it directly, host it
  on GitHub Pages, drop it on any web server, or paste it into an Apps
  Script HTML file — it works the same everywhere, with nothing else to
  bring along.
- `app.js` / `render.js` / `api.js` / `utils.js` / `config.js` — the same
  code as separate files, kept for convenience if you'd rather edit and
  maintain it in pieces. If you edit these, re-inline them into
  `index.html` before deploying (or point `index.html` back at them with
  `<script src="...">` tags) — `index.html` doesn't read these files on
  its own.

## What's new in the UI

Redesigned as a dark, dashboard-style app rather than a plain form:
- Top nav: **Log Update** ↔ **Insights**
- Inside Insights, a segmented switcher: **Overview** (the old dashboard —
  status split, blockers, current board), **Weekly** (View 2), **Bandwidth**
  (View 3), **Risk** (Control Mapping)
- Status/risk colour-coding is consistent everywhere (blue = in progress,
  amber = blocked on EQ, red = blocked on GC, green = delivered / low risk)

## Logging multiple workstreams in one day

The daily form isn't one-workstream-per-submission. It's one card per work
item — add as many as you touched that day (a "+ Add another workstream"
button under the last card), fill in Date and Your name once at the top,
and hit **Log update** once. Every card becomes its own row in the Log
sheet, so the underlying data and all the dashboards are unaffected —
only the data-entry experience changed.

**Stage is free text, not a dropdown.** What counts as a "stage" is
different in every workstream (Peer Review QA's stages look nothing like
Survey Packages' stages), so it can't be a fixed list without either
missing real values or ballooning into an unmanageable one. It's a plain
text field with autocomplete suggestions — seeded with common values, and
growing automatically from whatever people actually type, so dropdown-like
convenience is still there without the lock-in.

## Setup (15 minutes, one time)

1. **Create a new Google Sheet.** This will hold your live data — this is
   allowed to be a fresh sheet, it does not need to be the existing
   Status Tracker workbook.
2. **Extensions > Apps Script.** Delete the placeholder `myFunction`
   code, paste in the entire contents of `apps-script.gs`.
3. **Run `setupSheets` once.** Select it from the function dropdown at
   the top, click Run. Approve the permissions prompt (it's your own
   script touching your own sheet). This creates four tabs:
   - **Log** — one row per daily check-in, this is your database
   - **Config** — pre-seeded with your current workstreams, projects,
     and POC names, pulled from the latest workbook. Edit this tab any
     time to add a new project or person — no code changes needed, the
     form picks it up automatically.
   - **WeeklyNotes** — one row per workstream per week, filled by
     whoever submits the "Weekly note" form in the Weekly panel
   - **Risk** — pre-seeded from your Control Mapping tab. Edit ratings
     directly here; this feeds the Risk panel and rarely needs updating
4. **Deploy > New deployment > Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone within [your org]** (or Anyone, if people
     outside your Google Workspace need to submit too)
   - Click Deploy, copy the **web app URL** (ends in `/exec`).
5. **Open `config.js`** and paste that URL into `API_URL`.
6. **Host the frontend.** Easiest path: create a free GitHub repo, add
   the 6 frontend files (`index.html`, `app.js`, `render.js`, `api.js`,
   `utils.js`, `config.js`), turn on GitHub Pages. You'll get a URL you
   can share with the whole team (and with leadership, if you want them
   using it directly rather than seeing a screenshot).
   Alternatively, drop the files in any internal web server, or just
   open `index.html` locally for a quick test.
7. Share the URL with the team. That's the form. The **Dashboard** tab
   in the same page is the rollup — that's what you'd screen-share or
   link in the Sri update.

**After any future edit to `apps-script.gs`:** you must go to
Deploy > Manage deployments > Edit (pencil icon) > New version, or the
live URL keeps serving the old code.

## Data-quality notes from your current sheet

A few things I didn't try to "fix" silently, since they might be real
data rather than typos — worth a quick look:
- One row in "Initial Strat -HIR" has `#REF!` as a GC contact
  (2026-07-22, Nerren Nerren) — a broken cell reference in the original
  formula-linked sheet.
- "Salt lake" shows up both as a project name (under Restrat-HIR) and as
  a GC contact name (under Initial Strat-HIR, 2026-07-06 row) — worth
  confirming which is correct before it gets seeded into the Config tab
  as a person's name.

## What's intentionally left simple

- **No login/auth** — anyone with the link can submit. Fine for an
  internal team tool; if that's a problem, restricting the Web App to
  "Anyone within [org]" (step 4) requires a Google Workspace login,
  which covers most of it.
- **The old per-workstream matrix tabs** aren't recreated 1:1 — the
  "By workstream" table and "Current status board" carry the same
  information, just live instead of hand-typed. If leadership
  specifically wants the old matrix *look*, that's a formula-based
  (QUERY/PIVOT) addition to the Sheet itself, doable on top of this
  without touching the form.
- **Weekly capacity is a flat 40hrs/person** (`DAILY_CAPACITY_HOURS` ×
  `WEEKLY_CAPACITY_DAYS` in `apps-script.gs`). Edit those two constants
  if your team's standard week differs, or if it should vary by person.
- **Carry-over logic** (Weekly panel) counts a project as carried over
  if it was touched last week, touched again this week, and isn't
  Delivered by week's end — a reasonable proxy, but if your team defines
  "carry over" differently, that's a one-function tweak in
  `getWeeklyUpdate`.
