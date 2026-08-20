/**
 * GIS Project Services — Status Tracker backend (v3)
 * -----------------------------------------------
 * One Log sheet (append-only, one row per daily check-in) is the single
 * source of truth for day-to-day status AND time spent. Everything else —
 * the per-workstream matrix views, the weekly rollup (View 2), the team
 * bandwidth view (View 3), the dashboard, the weekly delivered-projects
 * list — is COMPUTED from it on read. Nobody hand-copies rows into
 * per-workstream tabs anymore.
 *
 * Sheets that are NOT derivable from daily logs and get their own tabs:
 *   - WeeklyNotes: the qualitative bits of the weekly update (wins,
 *     next-week priorities, help needed, reasons for spillover) — these
 *     are a judgment call by a workstream lead, not something you can
 *     compute from a log line.
 *   - Risk: the workstream risk/complexity register (Control Mapping tab
 *     in the old workbook). Changes rarely, so it's a small static
 *     reference table rather than something logged daily.
 *   - WorkstreamCategory: whether a workstream counts as R&D or GIS Ops.
 *     This is a property of the workstream, not something re-entered on
 *     every log row — set it once per workstream, edit rarely.
 *   - StepEstimates: a "Step -> typical hours" lookup used only to
 *     pre-fill the Est Hours field on the form. Purely a convenience;
 *     editing a row here never overwrites anything already logged.
 *   - Comments: GC View's comment thread on blocked-on-GC items, so GC
 *     can confirm / push back / give an ETA without Log write access.
 *
 * SETUP (one time):
 *   1. Create a new Google Sheet.
 *   2. Extensions > Apps Script. Delete the placeholder code, paste this
 *      whole file in.
 *   3. Run `setupSheets` once (Run menu > setupSheets). Approve permissions.
 *      This creates Log, Config, WeeklyNotes, Risk, WorkstreamCategory,
 *      StepEstimates, and Comments tabs, seeded with your current data.
 *   4. Deploy > New deployment > Web app.
 *        - Execute as: Me
 *        - Who has access: Anyone within [your org], or Anyone
 *      Copy the web app URL.
 *   5. Paste that URL into API_URL in config.js on the frontend.
 *
 * Every deploy after the first: Deploy > Manage deployments > Edit > New
 * version. Editing this file does NOT update a live deployment on its own.
 *
 * UPGRADING AN EXISTING v2 SHEET:
 *   Run `setupSheets` again — it only creates tabs that don't already
 *   exist and never touches your Log, so it's safe to re-run. It will
 *   add the new WorkstreamCategory, StepEstimates, and Comments tabs
 *   without touching your existing Log/Config/WeeklyNotes/Risk data.
 *   The Log sheet itself picks up the new "Carry Over Reason" column
 *   automatically the next time someone submits — existing rows just
 *   read back with that field blank, nothing to migrate by hand.
 */

const LOG_SHEET_NAME = 'Log';
const CONFIG_SHEET_NAME = 'Config';
const WEEKLY_NOTES_SHEET_NAME = 'WeeklyNotes';
const RISK_SHEET_NAME = 'Risk';
const WORKSTREAM_CATEGORY_SHEET_NAME = 'WorkstreamCategory';
const STEP_ESTIMATES_SHEET_NAME = 'StepEstimates';
const COMMENTS_SHEET_NAME = 'Comments';

// Appended at the end (not inserted mid-row) on purpose — an existing
// live sheet's historical rows keep their column positions exactly as
// they are; new columns just read back blank for old rows instead of
// needing every row hand-shifted.
const LOG_HEADERS = [
  'Timestamp', 'Date', 'Submitted By', 'Workstream', 'Project',
  'Step/Stage', 'Urgency', 'Status', 'POC - EQ', 'POC - GC',
  'Update', 'Next Step', 'Time Bucket', 'Est Hours', 'Actual Hours', 'Comments',
  'Carry Over Reason'
];

const WEEKLY_NOTES_HEADERS = [
  'Timestamp', 'Week Start', 'Workstream', 'Submitted By',
  'Wins', 'Priorities Next Week', 'Help Needed', 'Reasons For Spillover'
];

const RISK_HEADERS = [
  'Workstream', 'Documentation Maturity', 'Specialized Expertise',
  'Process Dependency', 'Transferability', 'Overall Complexity', 'Visibility', 'Overall Control'
];

const WORKSTREAM_CATEGORY_HEADERS = ['Workstream', 'Category'];
const STEP_ESTIMATES_HEADERS = ['Step', 'Est Hours'];
const COMMENTS_HEADERS = ['Timestamp', 'Workstream', 'Project', 'Author', 'Comment'];

// Status is the single field that replaces the old "Stage Owner" column —
// it tells you both what state a project is in AND whose court it's in.
// v3: "Blocked - EQ" is renamed "Carry Over" (same slot in the workflow —
// something that spilled over for an internal reason — but now paired
// with a required-ish reason field instead of implying GC is the holdup).
// normalizeStatus() below maps any pre-existing "Blocked - EQ" rows onto
// "Carry Over" on read, so nothing needs to be edited in old sheet rows.
const STATUS_OPTIONS = ['In Progress', 'Blocked - GC', 'Carry Over', 'Delivered / Complete'];
const LEGACY_STATUS_MAP = { 'Blocked - EQ': 'Carry Over' };
function normalizeStatus(status) {
  return LEGACY_STATUS_MAP[status] || status;
}

const URGENCY_OPTIONS = ['Very High', 'High', 'Medium', 'Low', 'Nice to have', 'Unassigned'];
const STEP_SUGGESTIONS = ['Pre-processing', 'Product Update', 'Post Processing', 'CEA Segmentation', 'Peer Review QA', 'Testing Phase', 'Review', 'Final QA', 'Delivered'];
// v3: added 'Audit Triggered Rework' alongside 'Rework' — same bucket
// family, but keeps audit-driven rework distinguishable from routine
// rework in the Bandwidth breakdown instead of them blurring together.
// v3: added 'Audit Triggered Rework' alongside 'Rework'. v3.2: added the
// two Training & KT buckets — always available in the dropdown (not
// gated behind picking the Training & KT workstream), same as every
// other bucket.
const TIME_BUCKET_OPTIONS = ['Execution', 'QA / Review', 'Coordination / Waiting on GC', 'Admin / Meetings', 'Rework', 'Audit Triggered Rework', 'Training & KT - Given', 'Training & KT - Received'];
const CATEGORY_OPTIONS = ['Ops', 'R&D'];

// Weekly capacity used for the bandwidth view (Effective daily hours x
// working days, same constants as View 3 in the workbook). Edit here if
// your team's standard week changes.
const DAILY_CAPACITY_HOURS = 8;
const WEEKLY_CAPACITY_DAYS = 5;
const WEEKLY_CAPACITY_HOURS = DAILY_CAPACITY_HOURS * WEEKLY_CAPACITY_DAYS;

// How many days back the dashboard's "Delivered" section shows by
// default — the all-time list was getting cluttered with everything
// ever delivered. "Show all" in the UI passes deliveredDays=all to see
// the full history again.
const DEFAULT_DELIVERED_WINDOW_DAYS = 14;

// v3: workstreams that are logged (so people can still record work
// against them) but excluded from every computed Insights view — not
// initiative-level enough to be useful in a rollup. The Log Update form
// still offers them normally.
// v3.2: added Training & KT — it's not a project-level workstream, it
// has its own dedicated "Training Metrics" view instead (see
// getTrainingMetrics below).
const TRAINING_WORKSTREAM = 'Training & KT';
const TRAINING_BUCKET_GIVEN = 'Training & KT - Given';
const TRAINING_BUCKET_RECEIVED = 'Training & KT - Received';
const INSIGHTS_EXCLUDED_WORKSTREAMS = ['Miscellaneous', TRAINING_WORKSTREAM];
function excludeNonInsightRows(rows) {
  return rows.filter(r => INSIGHTS_EXCLUDED_WORKSTREAMS.indexOf(r.workstream) === -1);
}

// Seed data — reflects the workstreams actually in use as of Aug 2026.
// Config sheet is the editable source of truth after setup — edit rows
// there to add new projects/POCs, no code changes needed.
const SEED_WORKSTREAM_PROJECTS = {
  'Initial Strat - HIR': ['Nerren Nerren', 'Quobba', 'Burandilla Cairns', 'Mt Philip', 'Bulla Park'],
  'Initial Stratification - NFMR': ['Elvanbrook & Dalkeith', 'Sandford'],
  'Change Detections': ['Berangabah Yallock, Salt Lake, Nimboy 2'],
  'Restrat-HIR': ['Yathonga(rework)'],
  'Fire Impact Assessment': ['Strathmore'],
  'Survey Packages': ['Edaggee'],
  'AD Survey Packages': ['AD survey package overlaps'],
  'Ad-hoc': [],
  'WS1 - Paddock Mapping & Digitizing': ['Nimboy 1'],
  'WS3: ALS to CPC': [],
  'Peer Review QA': ['Nerren Nerren', 'Yathonga', 'Thoura'],
  'CarbonPlus': [],
  'AM Products QA': [],
  'Miscellaneous': [],
  'Training & KT': []
};
const SEED_POC_EQ = ['Rupaz', 'Radha', 'Nikhil', 'Yoga', 'Thoura'];
const SEED_POC_GC = ['Chatura', 'Elissa', 'Emma', 'Ines', 'Kristie', 'Louise', 'Madeleine', 'Mary', 'Patrick Howie', 'Shanelle', 'Shannon', 'Vaibhav', 'Xavier', 'Silas', 'Sally'];

// Seed data from the "Control Mapping" tab — a static risk/complexity
// register, one row per workstream. Ratings are High / Medium / Low.
const SEED_RISK = [
  ['Restrat-HIR', 'High', 'Low', 'High', 'Medium', 'High', 'Medium', 'Low'],
  ['Initial Strat - HIR', 'High', 'Medium', 'High', 'High', 'Medium', 'Medium', 'Medium'],
  ['Initial Stratification - NFMR', 'High', 'Medium', 'High', 'High', 'Medium', 'Medium', 'Medium'],
  ['Change Detections', 'High', 'Low', 'Low', 'High', 'Low', 'Medium', 'Medium'],
  ['Fire Impact Assessment', 'Low', 'Low', 'Low', 'High', 'Low', 'Low', 'Medium'],
  ['Ad-hoc', 'Medium', 'Low', 'Low', 'High', 'Low', 'Low', 'Medium'],
  ['Survey Packages', 'Medium', 'Low', 'Low', 'High', 'Low', 'Low', 'Medium'],
  ['WS1 - Paddock Mapping & Digitizing', 'Low', 'Low', 'Medium', 'High', 'Medium', 'High', 'Medium'],
  ['WS3: ALS to CPC', 'Medium', 'High', 'Medium', 'Low', 'High', 'Medium', 'Medium']
];

// v3: which workstreams count as R&D vs GIS Ops, for the Bandwidth
// panel's two-level split (team-wide R&D-vs-Ops, then drill into Ops
// workstreams). This is a property of the workstream, set once here —
// not re-picked on every log entry. Anything not listed defaults to
// 'Ops' (see workstreamCategoryMap()). Edit the WorkstreamCategory tab
// directly to reclassify a workstream; no code changes needed.
const SEED_WORKSTREAM_CATEGORY = {
  'WS1 - Paddock Mapping & Digitizing': 'R&D',
  'WS3: ALS to CPC': 'R&D'
  // everything else defaults to 'Ops'
};

// v3: "Step -> typical Est Hours" lookup, used only to pre-fill the Est
// Hours field on the form (never overwrites a value someone already
// typed). Seeded from actual historical averages in your Log where there
// was enough data to trust (Post Processing, Processing, Peer Review QA,
// etc.); the rest are rough starting placeholders with no history yet —
// tune any of these directly in the StepEstimates tab at any time.
const SEED_STEP_ESTIMATES = {
  'Pre-processing': 2,
  'Product Update': 3,
  'Post Processing': 4,        // historical avg ~3.8h
  'Processing': 3,             // historical avg ~2.9h
  'CEA Segmentation': 4,       // historical avg ~3.75h
  'Peer Review QA': 2,         // historical avg ~2.1h
  'Testing Phase': 3,
  'Review': 2.5,               // historical avg ~2.5h
  'Review Changes': 3,         // historical avg ~3h
  'Final QA': 1,
  'Delivered': 0.5,
  'Model Point Allocation': 4.5,
  'Script Modification': 3.5,
  'Manual Relocation of Points': 6.5,
  'Automation': 5,
  'Paddock Mapping': 3.5,
  'Documentation': 2,
  'Auditor Triggered Restrats': 3,
  'QA': 1.5
};

// ---------------------------------------------------------------------
// One-time setup
// ---------------------------------------------------------------------
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let log = ss.getSheetByName(LOG_SHEET_NAME);
  if (!log) {
    log = ss.insertSheet(LOG_SHEET_NAME);
    log.appendRow(LOG_HEADERS);
    log.setFrozenRows(1);
    log.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold');
    log.autoResizeColumns(1, LOG_HEADERS.length);
  } else {
    // Upgrading an existing sheet: never clear real data. Just make sure
    // any new trailing columns (e.g. "Carry Over Reason") exist in the
    // header row so submitLogEntry can find them by name.
    ensureTrailingHeaders(log, LOG_HEADERS);
  }

  let config = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!config) {
    config = ss.insertSheet(CONFIG_SHEET_NAME);
    config.appendRow(['Workstream', 'Project', 'POC - EQ (options)', 'POC - GC (options)']);
    config.setFrozenRows(1);
    config.getRange(1, 1, 1, 4).setFontWeight('bold');

    let row = 2;
    Object.keys(SEED_WORKSTREAM_PROJECTS).forEach(ws => {
      const projects = SEED_WORKSTREAM_PROJECTS[ws];
      if (projects.length === 0) {
        config.getRange(row, 1).setValue(ws);
        row++;
      } else {
        projects.forEach(project => {
          config.getRange(row, 1).setValue(ws);
          config.getRange(row, 2).setValue(project);
          row++;
        });
      }
    });
    SEED_POC_EQ.forEach((name, i) => config.getRange(2 + i, 3).setValue(name));
    SEED_POC_GC.forEach((name, i) => config.getRange(2 + i, 4).setValue(name));
    config.autoResizeColumns(1, 4);
  }

  let weeklyNotes = ss.getSheetByName(WEEKLY_NOTES_SHEET_NAME);
  if (!weeklyNotes) {
    weeklyNotes = ss.insertSheet(WEEKLY_NOTES_SHEET_NAME);
    weeklyNotes.appendRow(WEEKLY_NOTES_HEADERS);
    weeklyNotes.setFrozenRows(1);
    weeklyNotes.getRange(1, 1, 1, WEEKLY_NOTES_HEADERS.length).setFontWeight('bold');
    weeklyNotes.autoResizeColumns(1, WEEKLY_NOTES_HEADERS.length);
  }

  let risk = ss.getSheetByName(RISK_SHEET_NAME);
  if (!risk) {
    risk = ss.insertSheet(RISK_SHEET_NAME);
    risk.appendRow(RISK_HEADERS);
    risk.setFrozenRows(1);
    risk.getRange(1, 1, 1, RISK_HEADERS.length).setFontWeight('bold');
    SEED_RISK.forEach((row, i) => risk.getRange(2 + i, 1, 1, row.length).setValues([row]));
    risk.autoResizeColumns(1, RISK_HEADERS.length);
  }

  let wsCategory = ss.getSheetByName(WORKSTREAM_CATEGORY_SHEET_NAME);
  if (!wsCategory) {
    wsCategory = ss.insertSheet(WORKSTREAM_CATEGORY_SHEET_NAME);
    wsCategory.appendRow(WORKSTREAM_CATEGORY_HEADERS);
    wsCategory.setFrozenRows(1);
    wsCategory.getRange(1, 1, 1, WORKSTREAM_CATEGORY_HEADERS.length).setFontWeight('bold');
    // Seed one row per known workstream (from Config's seed list) so the
    // tab shows everything up front instead of only the two overridden
    // to R&D — makes it obvious this is meant to be reviewed/edited.
    const allWorkstreams = Object.keys(SEED_WORKSTREAM_PROJECTS);
    allWorkstreams.forEach((ws, i) => {
      wsCategory.getRange(2 + i, 1).setValue(ws);
      wsCategory.getRange(2 + i, 2).setValue(SEED_WORKSTREAM_CATEGORY[ws] || 'Ops');
    });
    wsCategory.autoResizeColumns(1, WORKSTREAM_CATEGORY_HEADERS.length);
  }

  let stepEstimates = ss.getSheetByName(STEP_ESTIMATES_SHEET_NAME);
  if (!stepEstimates) {
    stepEstimates = ss.insertSheet(STEP_ESTIMATES_SHEET_NAME);
    stepEstimates.appendRow(STEP_ESTIMATES_HEADERS);
    stepEstimates.setFrozenRows(1);
    stepEstimates.getRange(1, 1, 1, STEP_ESTIMATES_HEADERS.length).setFontWeight('bold');
    let row = 2;
    Object.keys(SEED_STEP_ESTIMATES).forEach(step => {
      stepEstimates.getRange(row, 1).setValue(step);
      stepEstimates.getRange(row, 2).setValue(SEED_STEP_ESTIMATES[step]);
      row++;
    });
    stepEstimates.autoResizeColumns(1, STEP_ESTIMATES_HEADERS.length);
  }

  let comments = ss.getSheetByName(COMMENTS_SHEET_NAME);
  if (!comments) {
    comments = ss.insertSheet(COMMENTS_SHEET_NAME);
    comments.appendRow(COMMENTS_HEADERS);
    comments.setFrozenRows(1);
    comments.getRange(1, 1, 1, COMMENTS_HEADERS.length).setFontWeight('bold');
    comments.autoResizeColumns(1, COMMENTS_HEADERS.length);
  }

  SpreadsheetApp.getUi().alert('Setup complete. Log, Config, WeeklyNotes, Risk, WorkstreamCategory, StepEstimates, and Comments tabs are ready. Now deploy this as a Web App.');
}

// Adds any headers from `expected` that aren't already present in the
// sheet's header row, appending them as new trailing columns. Existing
// columns and all existing data rows are left completely untouched.
function ensureTrailingHeaders(sheet, expected) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let nextCol = lastCol;
  expected.forEach(h => {
    if (existing.indexOf(h) === -1) {
      nextCol++;
      sheet.getRange(1, nextCol).setValue(h).setFontWeight('bold');
    }
  });
}

// ---------------------------------------------------------------------
// Entry point: writes (form submissions)
// ---------------------------------------------------------------------
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.type === 'weekly') return submitWeeklyNote(body);
    if (body.type === 'comment') return submitComment(body);
    return submitLogEntry(body);
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function submitLogEntry(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);

  // A submission is either the new shape — { date, submittedBy, entries: [...] },
  // covering everything one person worked on in a day across any number of
  // workstreams — or, for backward compatibility, a single flat entry.
  const date = body.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const submittedBy = body.submittedBy || '';
  const entries = Array.isArray(body.entries) && body.entries.length ? body.entries : [body];

  // Validate the whole batch before touching anything — a submission
  // that fails partway through should never partially write to the Log
  // or partially add new workstreams/projects to Config.
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.workstream || !entry.project || !entry.status) {
      return jsonOutput({ ok: false, error: `Entry ${i + 1}: workstream, project, and status are required.` });
    }
  }

  const rows = [];
  entries.forEach(entry => {
    // Two-way Config sync: if this workstream/project combo was typed
    // through the form's "+ Add ... not on this list" flow rather than
    // picked from the dropdown, write it back to Config (and
    // WorkstreamCategory, if it's a brand-new workstream) so it shows
    // up as a normal option for everyone else from now on — not just
    // buried in this one Log row. No-ops instantly if it's already
    // there, so this is safe to call on every submission.
    ensureConfigEntry(entry.workstream, entry.project);

    rows.push([
      new Date(),
      entry.date || date,
      entry.submittedBy || submittedBy,
      entry.workstream,
      entry.project,
      entry.step || '',
      entry.urgency || '',
      entry.status,
      entry.pocEQ || '',
      entry.pocGC || '',
      entry.update || '',
      entry.nextStep || '',
      entry.timeBucket || '',
      entry.estHours || '',
      entry.actualHours || '',
      entry.comments || '',
      entry.carryOverReason || ''
    ]);
  });

  if (!rows.length) return jsonOutput({ ok: false, error: 'No entries to log.' });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);

  return jsonOutput({ ok: true, count: rows.length });
}

// ---------------------------------------------------------------------
// Two-way Config sync (see submitLogEntry). Config allows multiple rows
// per workstream — one per project, same shape as manual entry — so
// "ensure this pair exists" just means "append a row if this exact
// (workstream, project) combo isn't already there."
// ---------------------------------------------------------------------
function ensureConfigEntry(workstream, project) {
  if (!workstream) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  let workstreamExists = false;
  let pairExists = false;
  for (let i = 1; i < values.length; i++) {
    const ws = values[i][0];
    const proj = values[i][1];
    if (ws === workstream) {
      workstreamExists = true;
      if ((project || '') === (proj || '')) { pairExists = true; break; }
    }
  }
  if (pairExists) return;
  sheet.appendRow([workstream, project || '', '', '']);
  // A genuinely new workstream (not just a new project under a known
  // one) also needs a WorkstreamCategory row, or it'll silently default
  // to 'Ops' in the Bandwidth split — which is a reasonable default,
  // but give it an explicit row so it's visible and easy to correct.
  if (!workstreamExists) ensureWorkstreamCategoryEntry(workstream);
}

function ensureWorkstreamCategoryEntry(workstream) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORKSTREAM_CATEGORY_SHEET_NAME);
  if (!sheet) return;
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === workstream) return;
  }
  sheet.appendRow([workstream, 'Ops']);
}

function submitWeeklyNote(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WEEKLY_NOTES_SHEET_NAME);

  if (!body.workstream || !body.weekStart) {
    return jsonOutput({ ok: false, error: 'Workstream and week start are required.' });
  }

  sheet.appendRow([
    new Date(),
    body.weekStart,
    body.workstream,
    body.submittedBy || '',
    body.wins || '',
    body.priorities || '',
    body.helpNeeded || '',
    body.reasonsForSpillover || ''
  ]);

  return jsonOutput({ ok: true });
}

function submitComment(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COMMENTS_SHEET_NAME);

  if (!body.workstream || !body.project || !body.comment) {
    return jsonOutput({ ok: false, error: 'Workstream, project, and comment are required.' });
  }

  sheet.appendRow([
    new Date(),
    body.workstream,
    body.project,
    body.author || '',
    body.comment
  ]);

  return jsonOutput({ ok: true });
}

// ---------------------------------------------------------------------
// Entry point: reads (config + dashboard)
// ---------------------------------------------------------------------
function doGet(e) {
  const action = (e.parameter.action || 'config');
  try {
    if (action === 'config') return jsonOutput(getConfig());
    if (action === 'dashboard') return jsonOutput(getDashboard(e.parameter));
    if (action === 'log') return jsonOutput(getRecentLog(e.parameter));
    if (action === 'weekly') return jsonOutput(getWeeklyUpdate(e.parameter));
    if (action === 'bandwidth') return jsonOutput(getBandwidth(e.parameter));
    if (action === 'deliveries') return jsonOutput(getWeeklyDeliveries(e.parameter));
    if (action === 'carryovers') return jsonOutput(getWeeklyCarryOvers(e.parameter));
    if (action === 'training') return jsonOutput(getTrainingMetrics(e.parameter));
    if (action === 'risk') return jsonOutput(getRisk());
    if (action === 'comments') return jsonOutput(getComments());
    return jsonOutput({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// Config: powers the form's dropdowns, always reflects the Config tab
// ---------------------------------------------------------------------
function getConfig() {
  const config = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME);
  const values = config.getDataRange().getValues();
  values.shift(); // header

  const projectsByWorkstream = {};
  const pocEQ = new Set();
  const pocGC = new Set();

  values.forEach(row => {
    const [ws, project, eq, gc] = row;
    if (ws && !projectsByWorkstream[ws]) projectsByWorkstream[ws] = [];
    if (ws && project) {
      if (projectsByWorkstream[ws].indexOf(project) === -1) projectsByWorkstream[ws].push(project);
    }
    if (eq) pocEQ.add(eq);
    if (gc) pocGC.add(gc);
  });

  // Stage/Step can't be a fixed list — it means different things in
  // different workstreams (a Peer Review QA "stage" looks nothing like a
  // Survey Packages "stage"). It's a free-text field; this is just a
  // growing set of suggestions seeded with common ones, plus whatever
  // people have actually typed into the Log so far.
  const stepSuggestions = new Set(STEP_SUGGESTIONS);
  readLogRows().forEach(r => { if (r.step) stepSuggestions.add(r.step); });

  return {
    ok: true,
    workstreams: Object.keys(projectsByWorkstream),
    projectsByWorkstream: projectsByWorkstream,
    pocEQ: Array.from(pocEQ),
    pocGC: Array.from(pocGC),
    statuses: STATUS_OPTIONS,
    urgencies: URGENCY_OPTIONS,
    steps: Array.from(stepSuggestions),
    timeBuckets: TIME_BUCKET_OPTIONS,
    workstreamCategory: workstreamCategoryMap(),
    stepEstimates: stepEstimatesMap()
  };
}

// v3: workstream -> 'Ops' | 'R&D', read from the WorkstreamCategory tab.
// Anything not listed there defaults to 'Ops' so a brand-new workstream
// never silently breaks the Bandwidth split — it just needs a row added
// (or left as the Ops default) whenever someone gets to it.
function workstreamCategoryMap() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORKSTREAM_CATEGORY_SHEET_NAME);
  const map = {};
  if (!sheet) return map;
  const values = sheet.getDataRange().getValues();
  values.shift();
  values.forEach(([ws, category]) => {
    if (ws) map[ws] = (category === 'R&D') ? 'R&D' : 'Ops';
  });
  return map;
}

function categoryFor(workstream, categoryMap) {
  return categoryMap[workstream] || 'Ops';
}

// v3: Step -> typical Est Hours, read from the StepEstimates tab. Used
// only as a pre-fill suggestion on the form; the person can always
// overwrite it, and it's never used to backfill or judge past entries.
function stepEstimatesMap() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STEP_ESTIMATES_SHEET_NAME);
  const map = {};
  if (!sheet) return map;
  const values = sheet.getDataRange().getValues();
  values.shift();
  values.forEach(([step, hours]) => {
    if (step && hours !== '' && hours !== null) map[step] = Number(hours);
  });
  return map;
}

// ---------------------------------------------------------------------
// Dashboard: rollups computed live from the Log sheet.
// Mirrors the shape of the weekly Sri email — status split, per-workstream
// table, current status board, and a "blocked N days running" callout —
// but computed on demand instead of hand-typed.
//
// KEY BEHAVIOR: Blocked/Carry Over projects persist in the dashboard
// until explicitly moved or marked delivered. The time-range filter only
// affects the "status split" aggregate count; the "current status board"
// always shows the latest status for each project regardless of date
// range. "Delivered / Complete" projects are excluded from currentBoard
// and shown in a separate deliveredProjects section (windowed to the
// last `deliveredDays` days by default — pass deliveredDays=all for the
// full history), and are INCLUDED in all metrics.
// ---------------------------------------------------------------------
function readLogRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  return values.map(r => ({
    timestamp: r[idx['Timestamp']],
    date: r[idx['Date']],
    submittedBy: r[idx['Submitted By']],
    workstream: r[idx['Workstream']],
    project: r[idx['Project']],
    step: r[idx['Step/Stage']],
    urgency: r[idx['Urgency']],
    status: normalizeStatus(r[idx['Status']]),
    pocEQ: r[idx['POC - EQ']],
    pocGC: r[idx['POC - GC']],
    update: r[idx['Update']],
    nextStep: r[idx['Next Step']],
    timeBucket: r[idx['Time Bucket']],
    estHours: r[idx['Est Hours']],
    actualHours: r[idx['Actual Hours']],
    comments: r[idx['Comments']],
    carryOverReason: idx['Carry Over Reason'] !== undefined ? r[idx['Carry Over Reason']] : ''
  })).filter(r => r.workstream);
}

function filterByDate(rows, from, to) {
  if (!from && !to) return rows;
  return rows.filter(r => {
    const d = new Date(r.date);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function getDashboard(params) {
  const from = params.from ? new Date(params.from) : null;
  const to = params.to ? new Date(params.to) : null;
  const categoryMap = workstreamCategoryMap();

  // Read ALL log rows (not filtered by date yet) — Miscellaneous is
  // logged normally but excluded from every Insights rollup below.
  const allRows = excludeNonInsightRows(readLogRows());

  // For status split, use only rows within the date range
  const dateFilteredRows = filterByDate(allRows, from, to);

  // IMPORTANT: Include ALL statuses (including Delivered) in metrics
  const totalChecks = dateFilteredRows.length;
  const byStatus = {};
  STATUS_OPTIONS.forEach(s => byStatus[s] = 0);
  dateFilteredRows.forEach(r => { if (byStatus[r.status] !== undefined) byStatus[r.status]++; });

  const statusSplit = STATUS_OPTIONS.map(s => ({
    status: s,
    count: byStatus[s],
    pct: totalChecks ? Math.round((byStatus[s] / totalChecks) * 100) : 0
  }));

  // Per-workstream rollup (INCLUDE delivered in counts)
  const wsMap = {};
  dateFilteredRows.forEach(r => {
    if (!wsMap[r.workstream]) {
      wsMap[r.workstream] = { workstream: r.workstream, projects: new Set(), blockedGC: 0, carryOver: 0, delivered: 0, inProgress: 0 };
    }
    const w = wsMap[r.workstream];
    w.projects.add(r.project);
    if (r.status === 'Blocked - GC') w.blockedGC++;
    else if (r.status === 'Carry Over') w.carryOver++;
    else if (r.status === 'In Progress') w.inProgress++;
    else if (r.status === 'Delivered / Complete') w.delivered++;
  });
  const byWorkstream = Object.values(wsMap).map(w => ({
    workstream: w.workstream,
    category: categoryFor(w.workstream, categoryMap),
    distinctProjects: w.projects.size,
    blockedGC: w.blockedGC,
    carryOver: w.carryOver,
    delivered: w.delivered,
    inProgress: w.inProgress
  }));

  // Current status board: latest entry per (workstream, project) from ALL time,
  // EXCLUDING delivered projects (they go in their own section)
  const latestMap = {};
  const deliveredMap = {};
  allRows.forEach(r => {
    const key = r.workstream + '||' + r.project;

    if (r.status === 'Delivered / Complete') {
      // Track delivered projects separately
      const existing = deliveredMap[key];
      if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
        deliveredMap[key] = r;
      }
      // Remove from active board if it was there
      delete latestMap[key];
      return;
    }

    // For non-delivered, track in active board
    const existing = latestMap[key];
    if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
      latestMap[key] = r;
    }
  });

  const currentBoard = Object.values(latestMap)
    .map(r => Object.assign({ category: categoryFor(r.workstream, categoryMap) }, r))
    .sort((a, b) => a.workstream.localeCompare(b.workstream));

  // Delivered section: windowed to the last N days by default so the
  // list doesn't just accumulate forever. deliveredDays=all shows
  // everything, same as before.
  const deliveredDaysParam = params.deliveredDays;
  let deliveredRowsAll = Object.values(deliveredMap);
  let deliveredProjects;
  if (deliveredDaysParam === 'all') {
    deliveredProjects = deliveredRowsAll;
  } else {
    const windowDays = deliveredDaysParam ? parseInt(deliveredDaysParam, 10) : DEFAULT_DELIVERED_WINDOW_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);
    deliveredProjects = deliveredRowsAll.filter(r => new Date(r.timestamp) >= cutoff);
  }
  deliveredProjects = deliveredProjects
    .map(r => Object.assign({ category: categoryFor(r.workstream, categoryMap) }, r))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Blocker callout: projects currently Blocked-GC or Carry Over, with how many of their
  // last N logged days were also in that same state (consecutive streak).
  // Uses ALL historical entries, not just the date range.
  const blockedNow = currentBoard.filter(r => r.status === 'Blocked - GC' || r.status === 'Carry Over');
  const blockers = blockedNow.map(b => {
    const history = allRows
      .filter(r => r.workstream === b.workstream && r.project === b.project && r.status !== 'Delivered / Complete')
      .sort((a, c) => new Date(c.date) - new Date(a.date));
    let streak = 0;
    for (const h of history) {
      if (h.status === b.status) streak++; else break;
    }
    return {
      workstream: b.workstream,
      project: b.project,
      status: b.status,
      streakDays: streak,
      nextStep: b.nextStep,
      carryOverReason: b.status === 'Carry Over' ? b.carryOverReason : ''
    };
  }).sort((a, c) => c.streakDays - a.streakDays);

  return {
    ok: true,
    totalChecks: totalChecks,
    statusSplit: statusSplit,
    byWorkstream: byWorkstream,
    currentBoard: currentBoard,
    deliveredProjects: deliveredProjects,
    deliveredWindowDays: deliveredDaysParam === 'all' ? 'all' : (deliveredDaysParam ? parseInt(deliveredDaysParam, 10) : DEFAULT_DELIVERED_WINDOW_DAYS),
    blockers: blockers
  };
}

// ---------------------------------------------------------------------
// Weekly Deliveries: "what got delivered this week, by workstream" —
// project names only, grouped by workstream, for a Thu-Wed work week
// (see mostRecentThursday() below for why). Same week-nav pattern as
// Bandwidth. A project appears under a week if any log row in that
// week marked it Delivered / Complete (a project that gets redelivered
// in a later week — e.g. rework — will show up again then too, which
// is intentional: it's reporting what happened that week, not a
// lifetime "ever delivered" flag).
// ---------------------------------------------------------------------
function getWeeklyDeliveries(params) {
  const weekStart = params.weekStart ? new Date(params.weekStart) : mostRecentThursday();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6); // following Wednesday — see mostRecentThursday()

  const categoryMap = workstreamCategoryMap();
  const rows = excludeNonInsightRows(filterByDate(readLogRows(), weekStart, weekEnd))
    .filter(r => r.status === 'Delivered / Complete');

  const wsMap = {};
  rows.forEach(r => {
    if (!wsMap[r.workstream]) {
      wsMap[r.workstream] = { workstream: r.workstream, category: categoryFor(r.workstream, categoryMap), projects: new Set() };
    }
    wsMap[r.workstream].projects.add(r.project);
  });

  const workstreams = Object.values(wsMap).map(w => ({
    workstream: w.workstream,
    category: w.category,
    projects: Array.from(w.projects).sort(),
    count: w.projects.size
  })).sort((a, b) => a.workstream.localeCompare(b.workstream));

  const totalDelivered = workstreams.reduce((sum, w) => sum + w.count, 0);

  return {
    ok: true,
    weekStart: Utilities.formatDate(weekStart, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    weekEnd: Utilities.formatDate(weekEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    totalDelivered: totalDelivered,
    workstreams: workstreams
  };
}

// ---------------------------------------------------------------------
// Weekly Carry-Overs: the direct counterpart to getWeeklyDeliveries —
// "what got logged as Carry Over this week, by workstream". Project
// names grouped by workstream, plus the most recent carry-over reason
// for each (so you can see WHY at a glance, not just what).
//
// Note this is a narrower, more literal idea than the "carryOverCount"
// already computed in getWeeklyUpdate (which flags anything touched
// last week AND this week AND still not delivered, regardless of
// status). This one only counts rows actually logged with the Carry
// Over status during the selected week — it answers "what did people
// explicitly flag as carrying over this week", not "what technically
// spilled across the week boundary". Both are legitimate views of
// spillover; they're kept separate rather than merged so neither
// definition gets diluted by the other.
// ---------------------------------------------------------------------
function getWeeklyCarryOvers(params) {
  const weekStart = params.weekStart ? new Date(params.weekStart) : mostRecentThursday();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6); // following Wednesday — see mostRecentThursday()

  const categoryMap = workstreamCategoryMap();
  const rows = excludeNonInsightRows(filterByDate(readLogRows(), weekStart, weekEnd))
    .filter(r => r.status === 'Carry Over');

  const wsMap = {};
  rows.forEach(r => {
    if (!wsMap[r.workstream]) {
      wsMap[r.workstream] = { workstream: r.workstream, category: categoryFor(r.workstream, categoryMap), projects: {} };
    }
    const existing = wsMap[r.workstream].projects[r.project];
    // Keep the most recent reason if a project was logged as Carry Over
    // more than once in the same week (e.g. a Monday and a Thursday
    // check-in both carrying it over) — latest entry wins, same
    // convention as the rest of the dashboard.
    if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
      wsMap[r.workstream].projects[r.project] = { reason: r.carryOverReason || '', timestamp: r.timestamp };
    }
  });

  const workstreams = Object.values(wsMap).map(w => {
    const projects = Object.keys(w.projects).sort().map(name => ({
      project: name,
      reason: w.projects[name].reason
    }));
    return {
      workstream: w.workstream,
      category: w.category,
      projects: projects,
      count: projects.length
    };
  }).sort((a, b) => a.workstream.localeCompare(b.workstream));

  const totalCarriedOver = workstreams.reduce((sum, w) => sum + w.count, 0);

  return {
    ok: true,
    weekStart: Utilities.formatDate(weekStart, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    weekEnd: Utilities.formatDate(weekEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    totalCarriedOver: totalCarriedOver,
    workstreams: workstreams
  };
}

// ---------------------------------------------------------------------
// Weekly Update (View 2 equivalent): per workstream, auto-computed
// planned/executed/carry-over counts from the Log, merged with the
// qualitative fields (wins, priorities, help needed, spillover reasons)
// a workstream lead submits once a week via the mini weekly-note form.
//
// Note: "carryOverCount" here is a different, broader idea than the new
// "Carry Over" status — it's "touched last week, touched again this
// week, still not delivered", regardless of which non-delivered status
// it's sitting in. The per-project Carry Over *status* (with its reason
// field) is one specific way a project can end up counted here.
// ---------------------------------------------------------------------
function getWeeklyUpdate(params) {
  const weekStart = params.weekStart ? new Date(params.weekStart) : mostRecentThursday();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6); // following Wednesday — see mostRecentThursday()
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekEnd.getDate() + 6); // previous Thu-Wed span's Wednesday

  const allRows = excludeNonInsightRows(readLogRows());
  const thisWeek = filterByDate(allRows, weekStart, weekEnd);
  const lastWeek = filterByDate(allRows, prevWeekStart, prevWeekEnd);

  const wsMap = {};
  const ensure = (ws) => {
    if (!wsMap[ws]) wsMap[ws] = { workstream: ws, plannedProjects: new Set(), executedProjects: new Set(), carryOverProjects: new Set() };
    return wsMap[ws];
  };

  thisWeek.forEach(r => {
    const w = ensure(r.workstream);
    w.plannedProjects.add(r.project);
    if (r.status === 'Delivered / Complete') w.executedProjects.add(r.project);
  });

  const lastWeekTouched = {};
  lastWeek.forEach(r => {
    lastWeekTouched[r.workstream + '||' + r.project] = true;
  });
  thisWeek.forEach(r => {
    const w = ensure(r.workstream);
    const key = r.workstream + '||' + r.project;
    if (lastWeekTouched[key] && r.status !== 'Delivered / Complete') {
      w.carryOverProjects.add(r.project);
    }
  });

  const notesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WEEKLY_NOTES_SHEET_NAME);
  const noteValues = notesSheet.getDataRange().getValues();
  noteValues.shift();
  const weekStartStr = Utilities.formatDate(weekStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const notesByWs = {};
  noteValues.forEach(row => {
    const [timestamp, noteWeekStart, workstream, submittedBy, wins, priorities, helpNeeded, reasons] = row;
    if (!workstream) return;
    const noteWeekStr = noteWeekStart instanceof Date
      ? Utilities.formatDate(noteWeekStart, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(noteWeekStart);
    if (noteWeekStr !== weekStartStr) return;
    // last one wins if a workstream lead re-submits
    notesByWs[workstream] = { submittedBy, wins, priorities, helpNeeded, reasons };
  });

  Object.keys(notesByWs).forEach(ws => ensure(ws));

  const result = Object.values(wsMap).map(w => {
    const note = notesByWs[w.workstream] || {};
    return {
      workstream: w.workstream,
      plannedCount: w.plannedProjects.size,
      executedCount: w.executedProjects.size,
      carryOverCount: w.carryOverProjects.size,
      plannedProjects: Array.from(w.plannedProjects),
      executedProjects: Array.from(w.executedProjects),
      carryOverProjects: Array.from(w.carryOverProjects),
      wins: note.wins || '',
      priorities: note.priorities || '',
      helpNeeded: note.helpNeeded || '',
      reasonsForSpillover: note.reasons || '',
      noteSubmitted: !!notesByWs[w.workstream]
    };
  }).sort((a, b) => a.workstream.localeCompare(b.workstream));

  return {
    ok: true,
    weekStart: weekStartStr,
    weekEnd: Utilities.formatDate(weekEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    workstreams: result
  };
}

// v3: the team's work week runs Thursday through the following
// Wednesday (Sat/Sun are off days sitting in the middle of that span),
// so every weekly view anchors on the most recent Thursday instead of
// the calendar Monday. If today IS Thursday, that's "this week"'s
// start. Used as the default when no weekStart/from param is given —
// each panel now defaults to showing the CURRENT week in progress,
// not the last completed one.
function mostRecentThursday() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun ... 4 = Thu ... 6 = Sat
  const diff = (day - 4 + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// v3: counts only Mon-Fri calendar days in [from, to] inclusive, so a
// full Thu-Wed week (7 calendar days, with a Sat+Sun sitting in the
// middle) correctly yields 5 working days — and therefore
// WEEKLY_CAPACITY_HOURS (40), not 56 — instead of naively multiplying
// every calendar day in the range by DAILY_CAPACITY_HOURS.
function countWeekdays(from, to) {
  let count = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// ---------------------------------------------------------------------
// Team Bandwidth (View 3 equivalent): hours logged per person per
// workstream for a date range, against a weekly capacity, so you can
// see who's over/under-loaded without a hand-built matrix.
//
// v3: two levels, as requested — a team-wide R&D-vs-Ops split
// (categoryTotals / person.byCategory), plus the existing per-workstream
// breakdown per person for drilling into the Ops (or R&D) workstreams
// themselves.
// ---------------------------------------------------------------------
function getBandwidth(params) {
  const from = params.from ? new Date(params.from) : mostRecentThursday();
  const to = params.to ? new Date(params.to) : (() => {
    const d = new Date(from); d.setDate(d.getDate() + 6); return d; // following Wednesday
  })();

  const categoryMap = workstreamCategoryMap();
  const rows = excludeNonInsightRows(filterByDate(readLogRows(), from, to));
  // Capacity is driven by actual working days (Mon-Fri) in the range,
  // not raw calendar days — a full Thu-Wed week spans 7 calendar days
  // but only 5 of them are working days (Sat/Sun sit in the middle),
  // so this correctly comes out to WEEKLY_CAPACITY_HOURS (40) rather
  // than over-counting the weekend.
  const weekdays = Math.max(1, countWeekdays(from, to));
  const capacityHours = Math.round(weekdays * DAILY_CAPACITY_HOURS * 10) / 10;

  const personMap = {};
  const workstreams = new Set();
  const categoryTotalsHours = { 'Ops': 0, 'R&D': 0 };

  rows.forEach(r => {
    const person = r.submittedBy || 'Unassigned';
    const hours = parseFloat(r.actualHours) || 0;
    const category = categoryFor(r.workstream, categoryMap);
    if (!personMap[person]) personMap[person] = { person, byWorkstream: {}, byCategory: { 'Ops': 0, 'R&D': 0 }, totalHours: 0 };
    personMap[person].byWorkstream[r.workstream] = (personMap[person].byWorkstream[r.workstream] || 0) + hours;
    personMap[person].byCategory[category] += hours;
    personMap[person].totalHours += hours;
    categoryTotalsHours[category] += hours;
    workstreams.add(r.workstream);
  });

  const people = Object.values(personMap).map(p => {
    const executionPct = Math.min(100, Math.round((p.totalHours / capacityHours) * 100));
    return {
      person: p.person,
      byWorkstream: p.byWorkstream,
      byCategory: { 'Ops': Math.round(p.byCategory['Ops'] * 10) / 10, 'R&D': Math.round(p.byCategory['R&D'] * 10) / 10 },
      totalHours: Math.round(p.totalHours * 10) / 10,
      executionPct: capacityHours ? executionPct : 0,
      bandwidthPct: capacityHours ? Math.max(0, 100 - executionPct) : 0
    };
  }).sort((a, b) => b.totalHours - a.totalHours);

  const totalHoursAll = categoryTotalsHours['Ops'] + categoryTotalsHours['R&D'];
  const categoryTotals = ['Ops', 'R&D'].map(cat => ({
    category: cat,
    hours: Math.round(categoryTotalsHours[cat] * 10) / 10,
    pct: totalHoursAll ? Math.round((categoryTotalsHours[cat] / totalHoursAll) * 100) : 0
  }));

  return {
    ok: true,
    from: Utilities.formatDate(from, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    to: Utilities.formatDate(to, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    capacityHours: capacityHours,
    workstreams: Array.from(workstreams),
    categoryTotals: categoryTotals,
    people: people
  };
}

// ---------------------------------------------------------------------
// Training Metrics: hours spent giving vs receiving training, per
// person, for a Thu-Wed week. This is the Training & KT workstream's
// own dedicated view — that workstream is deliberately excluded from
// every other Insights rollup (see INSIGHTS_EXCLUDED_WORKSTREAMS)
// since it isn't a project-level initiative. Mirrors the Bandwidth
// panel's shape: a team-wide Given-vs-Received split up top, then a
// per-person breakdown below.
//
// Only rows logged against the Training & KT workstream count, and
// only the two dedicated time buckets are split out (Given /
// Received) — a Training & KT row logged under some other time bucket
// still exists in the Log, it just won't show up in this split.
// ---------------------------------------------------------------------
function getTrainingMetrics(params) {
  const weekStart = params.weekStart ? new Date(params.weekStart) : mostRecentThursday();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6); // following Wednesday — see mostRecentThursday()

  const rows = filterByDate(readLogRows(), weekStart, weekEnd)
    .filter(r => r.workstream === TRAINING_WORKSTREAM);

  const personMap = {};
  const totals = { given: 0, received: 0 };

  rows.forEach(r => {
    const person = r.submittedBy || 'Unassigned';
    const hours = parseFloat(r.actualHours) || 0;
    if (!personMap[person]) personMap[person] = { person, given: 0, received: 0 };
    if (r.timeBucket === TRAINING_BUCKET_GIVEN) {
      personMap[person].given += hours;
      totals.given += hours;
    } else if (r.timeBucket === TRAINING_BUCKET_RECEIVED) {
      personMap[person].received += hours;
      totals.received += hours;
    }
  });

  const people = Object.values(personMap).map(p => ({
    person: p.person,
    givenHours: Math.round(p.given * 10) / 10,
    receivedHours: Math.round(p.received * 10) / 10,
    totalHours: Math.round((p.given + p.received) * 10) / 10
  })).sort((a, b) => b.totalHours - a.totalHours);

  const totalAll = totals.given + totals.received;

  return {
    ok: true,
    weekStart: Utilities.formatDate(weekStart, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    weekEnd: Utilities.formatDate(weekEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    totals: {
      givenHours: Math.round(totals.given * 10) / 10,
      receivedHours: Math.round(totals.received * 10) / 10,
      givenPct: totalAll ? Math.round((totals.given / totalAll) * 100) : 0,
      receivedPct: totalAll ? Math.round((totals.received / totalAll) * 100) : 0
    },
    people: people
  };
}

// ---------------------------------------------------------------------
// Risk: static workstream complexity/risk register (Control Mapping).
// Edit the Risk tab directly to update ratings — this rarely changes.
// ---------------------------------------------------------------------
function getRisk() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RISK_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const rows = values.filter(r => r[0]).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = r[i]);
    return obj;
  });
  return { ok: true, rows: rows };
}

function getRecentLog(params) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const limit = parseInt(params.limit || '50', 10);
  const rows = values.slice(-limit).reverse().map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = r[i]);
    return obj;
  });
  return { ok: true, rows: rows };
}

// ---------------------------------------------------------------------
// Comments: GC View's per-item comment thread, so GC can confirm, push
// back, or give an ETA on a blocked-on-GC item without needing Log
// write access. Keyed by workstream + project, same as the dashboard's
// currentBoard rows.
// ---------------------------------------------------------------------
function getComments() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COMMENTS_SHEET_NAME);
  if (!sheet) return { ok: true, rows: [] };
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);
  const rows = values.filter(r => r[idx['Workstream']]).map(r => ({
    timestamp: r[idx['Timestamp']],
    workstream: r[idx['Workstream']],
    project: r[idx['Project']],
    author: r[idx['Author']],
    comment: r[idx['Comment']]
  }));
  return { ok: true, rows: rows };
}
