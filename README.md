# GIS Project Services — Status Tracker (v3)

A one-stop replacement for the Excel workbook. Everyone logs their status
through one form; that write lands directly in a Google Sheet; every
dashboard view is computed live from that same sheet. Nobody hand-copies
rows between tabs.

## What changed in v3

Straight from your review notes:

| Note | What changed |
|---|---|
| "A field to capture month" | Not a new input — Month is derived from Date automatically wherever it's needed, so it can't drift out of sync with the actual date logged. |
| "R&D and GIS ops" | Added as a **per-workstream** property (not per log entry) — new **WorkstreamCategory** tab, one row per workstream, `Ops` or `R&D`. Seeded with `WS1 - Paddock Mapping & Digitizing` and `WS3: ALS to CPC` as R&D, everything else Ops — edit anytime as it evolves. |
| "Remove POC GC and EQ" | **Skipped for now** per your call — GC View is built around POC-GC, so this needs its own follow-up rather than a quick removal. |
| "Prefilled estimated hours based on step" | New **StepEstimates** tab (`Step` → `Est Hours`). When the Stage field matches a known step, Est Hours pre-fills — but only if you haven't already typed something, and you can always override it. Seeded from your actual historical averages where there was enough data (Post Processing, Processing, Peer Review QA, etc.); the rest are rough starting placeholders. |
| "Rework and Audit triggered rework" | Added **"Audit Triggered Rework"** as a new Time Bucket option, alongside the existing "Rework". |
| "Carry over in place of Blocked - EQ, reasons for that" | **"Blocked - EQ" is renamed "Carry Over"** across the whole app. A "Reason for carry over" field now appears on the form whenever that status is picked. Any historical "Blocked - EQ" rows still read back correctly (mapped automatically). |
| "No need to track check-ins" | Removed the "Check-ins logged" stat card and the Check-ins column from the workstream table. |
| "Optimise for delivered list — a lot of already-delivered projects" | The Delivered section now defaults to the **last 14 days** instead of all-time, with a **"Show all"** toggle to see the full history when you want it. |
| "Weekly snapshot — check and optimise for accuracy" | Reviewed `getWeeklyUpdate`; logic is unchanged (touched last week + this week + not delivered = carried over) but now clearly documented as a different, broader idea from the new per-item "Carry Over" *status* — see the code comment in `apps-script.gs`. Worth a look together against a real week if the numbers still feel off; that's a one-function tweak. |
| "Bandwidth at two levels — R&D/Ops and Ops workstreams" | The Bandwidth panel now shows a **team-wide R&D vs Ops split** at the top (using the new WorkstreamCategory tab), and keeps the existing per-person / per-workstream breakdown below it for drilling into workstreams. |
| New weekly delivered-projects list | New **Delivered** panel in Insights (renamed "Weekly delivery & carry-over") — same week-nav pattern as Bandwidth, lists project names delivered that week, grouped by workstream. |
| New weekly carry-over list | Same panel, second card — project names logged with status **Carry Over** that week, grouped by workstream, with the reason shown under each project. Direct counterpart to the delivered list, sharing the same week nav. |

## v3.1 — Miscellaneous filtered, Thu-Wed work week, current week by default

| Ask | What changed |
|---|---|
| "Miscellaneous filtered out from insights" | Log Update form still offers it (still a valid catch-all to log against), but it's now excluded from every computed Insights view — Overview, Weekly, Bandwidth, Delivered, Carry-over, Board. |
| "Figure out a way to make it Thursday to Thursday" | The work week now runs **Thursday through the following Wednesday** everywhere (Weekly, Bandwidth, Delivered/Carry-over) instead of Monday-Friday. Sat/Sun sit as off-days in the middle of that span and are excluded from capacity — a full week still comes out to exactly 40h, not 56h, because capacity is now driven by an actual weekday count instead of raw calendar days. |
| "Show the current week we are in" | All three weekly panels (Weekly, Bandwidth, Delivered/Carry-over) now default to the **current** Thu-Wed week on load, instead of the previously-completed one. |
| Autofill for estimated time | No changes requested — current behavior (pre-fills Est Hours from Stage on blur, only if empty) stays as-is. |
| Carry-over snapshot for weekly updates | Already covered by the "Carried over this week" card added to the Delivered panel — nothing further needed. |

One thing worth knowing: the "Weekly note" form's date field still needs to land on a Thursday to match up with the Weekly panel's lookup (it compares the note's week-start string against the computed week-start string exactly). It now defaults to the current week's Thursday and the label says so — but if someone manually picks a different date, make sure it's a Thursday or the note won't show up under the week they meant.


Also fixed along the way: the GC View's comment feature (posting a
comment on a blocked-on-GC item) had frontend code calling a backend
action that didn't exist yet — added `Comments` sheet + `getComments` /
`submitComment` so that actually works now.

## Upgrading your existing sheet

You do **not** need to start over.

1. Open Extensions > Apps Script on your existing sheet, replace the
   entire contents with the new `apps-script.gs`, save.
2. Run `setupSheets` again. It's safe to re-run — it only creates tabs
   that don't already exist yet (`WorkstreamCategory`, `StepEstimates`,
   `Comments`) and never touches your existing Log, Config, WeeklyNotes,
   or Risk data. Your Log sheet picks up the new "Carry Over Reason"
   column automatically the next time someone submits; old rows just
   read back with that field blank.
3. Open the new **WorkstreamCategory** tab and double check the R&D/Ops
   split matches reality (currently `WS1 - Paddock Mapping & Digitizing`
   and `WS3: ALS to CPC` are seeded as R&D — reclassify anything else
   that should count as R&D).
4. Open the new **StepEstimates** tab and sanity-check the pre-fill
   numbers — several are real historical averages from your Log, the
   rest are rough placeholders with no data behind them yet.
5. Deploy > Manage deployments > Edit (pencil) > New version, so the
   live URL actually serves this code.
6. Replace `index.html` (and/or `app.js` / `render.js` / `api.js` /
   `config.js` / `utils.js` if you maintain them separately) wherever
   you're hosting the frontend.

No changes needed to `API_URL` — same deployment URL as before, as long
as you used "New version" rather than a brand new deployment.

## Rolling this out safely on a live tool

Your team fills this in every day, so treat this as a real deploy, not
a file swap. Do it in this order and nobody loses data or gets a broken
form mid-entry:

**1. Duplicate the live sheet before touching anything.**
Open the real Google Sheet > File > Make a copy. Do all of steps 2-4
against the *copy* first. This is your rehearsal — schema changes
(new tabs, new columns) should never be tested against the sheet
people are actively logging into.

**2. Test the backend against the copy.**
In the copy's Extensions > Apps Script, paste in the new
`apps-script.gs`, run `setupSheets`, and confirm: the four new tabs
(WorkstreamCategory, StepEstimates, Comments — plus the Log sheet's
new trailing column) appear, and nothing in your existing Log/Config/
WeeklyNotes/Risk data moved or changed. Deploy the copy as its own
temporary Web App, point a local copy of the new `index.html` at that
temporary URL (edit `API_URL` in it just for this test), and click
through: submit a log entry, check every Insights tab loads, post a
GC View comment, submit a weekly note on a Thursday date.

**3. Once it checks out, apply the same backend change to production.**
Go to the *real* Apps Script project (bound to the real, live sheet —
not a new one, so history is preserved). Replace the code with the
same `apps-script.gs`, run `setupSheets` once (additive only, same
guarantee as step 2), then Deploy > Manage deployments > Edit (pencil)
> New version. This keeps the same `/exec` URL, so `API_URL` in the
frontend doesn't change and nobody needs a new link.

**4. Timing the backend deploy.**
Apps Script "new version" deploys take effect near-instantly and the
new code is backward-compatible with the current live frontend (old
dropdown labels, missing new fields — all handled gracefully), so
there's no real window of breakage. Still, do it at a quiet moment
(early morning, before end-of-day logging starts) rather than during
a burst of submissions, purely so you're not debugging with live
traffic in flight if something unexpected comes up.

**5. Swap the frontend.**
Push the new `index.html` to wherever it's hosted (GitHub Pages /
internal server). This is instant and doesn't touch anyone currently
mid-form — they keep using the page they already loaded until they
refresh or come back tomorrow. Nobody gets yanked out of a half-filled
form.

**6. Smoke test on production immediately after.**
Submit one real test entry (workstream: something obviously a test, or
use Ad-hoc), confirm it shows up in the Log sheet and on the Overview
board, then delete that test row from the Log sheet directly. Check
Insights tabs load, GC View comment posts.

**7. Give the team a heads-up, not just a silent swap.**
The visible changes people will notice logging in tomorrow: "Blocked -
EQ" is now "Carry Over" with a reason box, there's a new "Audit
Triggered Rework" time bucket option, Miscellaneous no longer shows up
in Insights, and the weekly panels now run Thursday-to-Wednesday
instead of Monday-Friday. A two-line Slack/email covering those four
things avoids a flood of "what happened to X" messages.

**8. Keep a rollback ready for 24-48h.**
Save a copy of the *previous* `apps-script.gs` and `index.html`
somewhere findable. If something's wrong: Deploy > Manage deployments
> Edit > pick the previous version from the dropdown (reverts the
backend instantly), and re-push the old `index.html`. Nobody's Log
data is at risk either way — every schema change here is additive,
nothing was deleted or renamed at the sheet level.

**One hygiene check before you commit:** open your live Config tab and
confirm the exact spelling of `WS1 - Paddock Mapping & Digitizing` and
`WS3: ALS to CPC` matches what's in the new WorkstreamCategory tab
letter-for-letter (including the colon vs dash). If they don't match,
those workstreams will silently default to "Ops" in the Bandwidth
split instead of showing as R&D — worth a 30-second look before you
deploy, not after. Also worth checking: if anyone has a weekly note
already submitted for the "old" Monday-anchored week that hasn't
happened yet this cycle, it won't match the new Thursday-anchored
lookup — not a data-loss issue (the row stays in WeeklyNotes either
way), just something that could look like a "missing note" the first
week after this deploys.

## Everything else

One Log sheet is still the single source of truth, everything else is
computed on read, and the setup/deploy steps are the same as before
(Apps Script Web App, Execute as Me, deploy, paste the URL into
`API_URL`).

## v3.2 — Two-way Config sync, Training & KT workstream, Training Metrics tab

| Ask | What changed |
|---|---|
| "If somebody adds a new workstream to the gsheets... reflect on the frontend, make it two-way" | The Sheet-to-frontend direction already worked (Config tab edits show up via the 2-min auto-refresh or the manual "Refresh options" button). What was missing was the other direction: typing a brand-new workstream or project through the form's "+ Add ... not on this list" flow only ever landed in that one person's Log row — it never showed up as a real dropdown option for anyone else. Fixed: the first time a new workstream/project combo is submitted, it's now also written back to the Config tab (and WorkstreamCategory, if it's a genuinely new workstream, defaulted to Ops). Already-known combos are a no-op, so this doesn't create duplicates or slow down normal submissions. |
| "New workstream Training & KT, filtered from insights, with Training & KT - Given / Received time buckets" | Added as a workstream (empty project list, same as Ad-hoc/CarbonPlus — type the training topic as the "project"), added to the excluded-from-Insights list alongside Miscellaneous, and added the two new Time Bucket options. |
| "Separate Training Metrics view, like Bandwidth, weekly" | New **Training Metrics** tab in Insights. Same shape as Bandwidth: a team-wide Given-vs-Received split up top, then per-person cards below (hours given, hours received, total), same Thu-Wed week-nav pattern, defaults to the current week. |

**Worth knowing about the two-way sync:** it triggers off the literal (workstream, project) pair in the submission, not off whether the person actually used the "+ Add new" button — so if someone somehow submits a slightly different spelling of an existing workstream (extra space, different capitalization), that becomes a *new* Config row rather than matching the existing one. Not harmful (nothing breaks), but it means Config is worth a periodic glance for near-duplicate workstream names, the same way any freeform-entry system needs light housekeeping.
