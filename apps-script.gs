/**
 * GIS Project Services — Status Tracker backend (v2)
 * -----------------------------------------------
 * One Log sheet (append-only, one row per daily check-in) is the single
 * source of truth for day-to-day status AND time spent. Everything else —
 * the per-workstream matrix views, the weekly rollup (View 2), the team
 * bandwidth view (View 3), the dashboard — is COMPUTED from it on read.
 * Nobody hand-copies rows into per-workstream tabs anymore.
 *
 * Two things are NOT derivable from daily logs and get their own sheets:
 *   - WeeklyNotes: the qualitative bits of the weekly update (wins,
 *     next-week priorities, help needed, reasons for spillover) — these
 *     are a judgment call by a workstream lead, not something you can
 *     compute from a log line.
 *   - Risk: the workstream risk/complexity register (Control Mapping tab
 *     in the old workbook). This changes rarely, so it's a small static
 *     reference table rather than something logged daily.
 *
 * SETUP (one time):
 *   1. Create a new Google Sheet.
 *   2. Extensions > Apps Script. Delete the placeholder code, paste this
 *      whole file in.
 *   3. Run `setupSheets` once (Run menu > setupSheets). Approve permissions.
 *      This creates Log, Config, WeeklyNotes, and Risk tabs, and seeds
 *      Config + Risk with your current data so nothing starts empty.
 *   4. Deploy > New deployment > Web app.
 *        - Execute as: Me
 *        - Who has access: Anyone within [your org], or Anyone
 *      Copy the web app URL.
 *   5. Paste that URL into API_URL in config.js on the frontend.
 *
 * Every deploy after the first: Deploy > Manage deployments > Edit > New
 * version. Editing this file does NOT update a live deployment on its own.
 */

const LOG_SHEET_NAME = 'Log';
const CONFIG_SHEET_NAME = 'Config';
const WEEKLY_NOTES_SHEET_NAME = 'WeeklyNotes';
const RISK_SHEET_NAME = 'Risk';

const LOG_HEADERS = [
  'Timestamp', 'Date', 'Submitted By', 'Workstream', 'Project',
  'Step/Stage', 'Urgency', 'Status', 'POC - EQ', 'POC - GC',
  'Update', 'Next Step', 'Time Bucket', 'Est Hours', 'Actual Hours', 'Comments'
];

const WEEKLY_NOTES_HEADERS = [
  'Timestamp', 'Week Start', 'Workstream', 'Submitted By',
  'Wins', 'Priorities Next Week', 'Help Needed', 'Reasons For Spillover'
];

const RISK_HEADERS = [
  'Workstream', 'Documentation Maturity', 'Specialized Expertise',
  'Process Dependency', 'Transferability', 'Overall Complexity', 'Visibility', 'Overall Control'
];

// Status is the single field that replaces the old "Stage Owner" column —
// it tells you both what state a project is in AND whose court it's in.
const STATUS_OPTIONS = ['In Progress', 'Blocked - GC', 'Blocked - EQ', 'Delivered / Complete'];
const URGENCY_OPTIONS = ['Very High', 'High', 'Medium', 'Low', 'Nice to have', 'Unassigned'];
const STEP_SUGGESTIONS = ['Pre-processing', 'Product Update', 'Post Processing', 'CEA Segmentation', 'Peer Review QA', 'Testing Phase', 'Review', 'Final QA', 'Delivered'];
const TIME_BUCKET_OPTIONS = ['Execution', 'QA / Review', 'Coordination / Waiting on GC', 'Admin / Meetings', 'Rework'];

// Weekly capacity used for the bandwidth view (Effective daily hours x
// working days, same constants as View 3 in the workbook). Edit here if
// your team's standard week changes.
const DAILY_CAPACITY_HOURS = 8;
const WEEKLY_CAPACITY_DAYS = 5;
const WEEKLY_CAPACITY_HOURS = DAILY_CAPACITY_HOURS * WEEKLY_CAPACITY_DAYS;

// Seed data extracted from the current Status Tracker workbook (Jul 2026).
// Config sheet is the editable source of truth after setup — edit rows
// there to add new projects/POCs, no code changes needed.
const SEED_WORKSTREAM_PROJECTS = {
  'Initial Strat - HIR': ['Nerren Nerren', 'Quobba', 'Burandilla Cairns', 'Mt Philip', 'Bulla Park'],
  'Initial Stratification - NFMR': ['Elvanbrook & Dalkeith', 'Sandford'],
  'Change Detections': ['Berangabah Yallock, Salt Lake, Nimboy 2'],
  'Restrat-HIR': ['Yathonga(rework)'],
  'Fire Impact Assessment': ['Strathmore'],
  'Survey Packages': ['Edaggee'],
  'Ad-hoc': ['AD survey package overlaps'],
  'WS1 - Paddock Mapping & Digitizing': ['Nimboy 1'],
  'WS3 - ALS to CPC': [],
  'Peer Review QA': ['Nerren Nerren', 'Yathonga', 'Thoura']
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
  ['WS3 - ALS to CPC', 'Medium', 'High', 'Medium', 'Low', 'High', 'Medium', 'Medium']
];

// ---------------------------------------------------------------------
// One-time setup
// ---------------------------------------------------------------------
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let log = ss.getSheetByName(LOG_SHEET_NAME);
  if (!log) log = ss.insertSheet(LOG_SHEET_NAME);
  log.clear();
  log.appendRow(LOG_HEADERS);
  log.setFrozenRows(1);
  log.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold');

  let config = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!config) config = ss.insertSheet(CONFIG_SHEET_NAME);
  config.clear();
  config.appendRow(['Workstream', 'Project', 'POC - EQ (options)', 'POC - GC (options)']);
  config.setFrozenRows(1);
  config.getRange(1, 1, 1, 4).setFontWeight('bold');

  let row = 2;
  Object.keys(SEED_WORKSTREAM_PROJECTS).forEach(ws => {
    SEED_WORKSTREAM_PROJECTS[ws].forEach(project => {
      config.getRange(row, 1).setValue(ws);
      config.getRange(row, 2).setValue(project);
      row++;
    });
  });
  SEED_POC_EQ.forEach((name, i) => config.getRange(2 + i, 3).setValue(name));
  SEED_POC_GC.forEach((name, i) => config.getRange(2 + i, 4).setValue(name));

  config.autoResizeColumns(1, 4);
  log.autoResizeColumns(1, LOG_HEADERS.length);

  let weeklyNotes = ss.getSheetByName(WEEKLY_NOTES_SHEET_NAME);
  if (!weeklyNotes) weeklyNotes = ss.insertSheet(WEEKLY_NOTES_SHEET_NAME);
  weeklyNotes.clear();
  weeklyNotes.appendRow(WEEKLY_NOTES_HEADERS);
  weeklyNotes.setFrozenRows(1);
  weeklyNotes.getRange(1, 1, 1, WEEKLY_NOTES_HEADERS.length).setFontWeight('bold');
  weeklyNotes.autoResizeColumns(1, WEEKLY_NOTES_HEADERS.length);

  let risk = ss.getSheetByName(RISK_SHEET_NAME);
  if (!risk) risk = ss.insertSheet(RISK_SHEET_NAME);
  risk.clear();
  risk.appendRow(RISK_HEADERS);
  risk.setFrozenRows(1);
  risk.getRange(1, 1, 1, RISK_HEADERS.length).setFontWeight('bold');
  SEED_RISK.forEach((row, i) => risk.getRange(2 + i, 1, 1, row.length).setValues([row]));
  risk.autoResizeColumns(1, RISK_HEADERS.length);

  SpreadsheetApp.getUi().alert('Setup complete. Log, Config, WeeklyNotes, and Risk tabs are ready. Now deploy this as a Web App.');
}

// ---------------------------------------------------------------------
// Entry point: writes (form submissions)
// ---------------------------------------------------------------------
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.type === 'weekly') return submitWeeklyNote(body);
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

  const rows = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.workstream || !entry.project || !entry.status) {
      return jsonOutput({ ok: false, error: `Entry ${i + 1}: workstream, project, and status are required.` });
    }
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
      entry.comments || ''
    ]);
  }

  if (!rows.length) return jsonOutput({ ok: false, error: 'No entries to log.' });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);

  return jsonOutput({ ok: true, count: rows.length });
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
    if (action === 'risk') return jsonOutput(getRisk());
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
    if (ws && project) {
      if (!projectsByWorkstream[ws]) projectsByWorkstream[ws] = [];
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
    timeBuckets: TIME_BUCKET_OPTIONS
  };
}

// ---------------------------------------------------------------------
// Dashboard: rollups computed live from the Log sheet.
// Mirrors the shape of the weekly Sri email — status split, per-workstream
// table, current status board, and a "blocked N days running" callout —
// but computed on demand instead of hand-typed.
//
// KEY CHANGE: Blocked projects persist in the dashboard until explicitly
// unblocked or marked delivered. The time-range filter only affects the
// "status split" aggregate count; the "current status board" always shows
// the latest status for each project regardless of date range.
// "Delivered / Complete" projects are excluded from currentBoard but shown
// in a separate deliveredProjects section, and INCLUDED in all metrics.
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
    status: r[idx['Status']],
    pocEQ: r[idx['POC - EQ']],
    pocGC: r[idx['POC - GC']],
    update: r[idx['Update']],
    nextStep: r[idx['Next Step']],
    timeBucket: r[idx['Time Bucket']],
    estHours: r[idx['Est Hours']],
    actualHours: r[idx['Actual Hours']],
    comments: r[idx['Comments']]
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
  
  // Read ALL log rows (not filtered by date yet)
  const allRows = readLogRows();
  
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
      wsMap[r.workstream] = { workstream: r.workstream, projects: new Set(), checks: 0, blockedGC: 0, blockedEQ: 0, delivered: 0, inProgress: 0 };
    }
    const w = wsMap[r.workstream];
    w.projects.add(r.project);
    w.checks++;
    if (r.status === 'Blocked - GC') w.blockedGC++;
    else if (r.status === 'Blocked - EQ') w.blockedEQ++;
    else if (r.status === 'In Progress') w.inProgress++;
    else if (r.status === 'Delivered / Complete') w.delivered++;
  });
  const byWorkstream = Object.values(wsMap).map(w => ({
    workstream: w.workstream,
    distinctProjects: w.projects.size,
    checks: w.checks,
    blockedGC: w.blockedGC,
    blockedEQ: w.blockedEQ,
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
  
  const currentBoard = Object.values(latestMap).sort((a, b) => a.workstream.localeCompare(b.workstream));
  const deliveredProjects = Object.values(deliveredMap).sort((a, b) => a.workstream.localeCompare(b.workstream));

  // Blocker callout: projects currently Blocked-GC or Blocked-EQ, with how many of their
  // last N logged days were also blocked (consecutive-blocked streak).
  // Uses ALL historical entries, not just the date range.
  const blockedNow = currentBoard.filter(r => r.status === 'Blocked - GC' || r.status === 'Blocked - EQ');
  const blockers = blockedNow.map(b => {
    const history = allRows
      .filter(r => r.workstream === b.workstream && r.project === b.project && r.status !== 'Delivered / Complete')
      .sort((a, c) => new Date(c.date) - new Date(a.date));
    let streak = 0;
    for (const h of history) {
      if (h.status === b.status) streak++; else break;
    }
    return { workstream: b.workstream, project: b.project, status: b.status, streakDays: streak, nextStep: b.nextStep };
  }).sort((a, c) => c.streakDays - a.streakDays);

  return {
    ok: true,
    totalChecks: totalChecks,
    statusSplit: statusSplit,
    byWorkstream: byWorkstream,
    currentBoard: currentBoard,
    deliveredProjects: deliveredProjects,
    blockers: blockers
  };
}

// ---------------------------------------------------------------------
// Weekly Update (View 2 equivalent): per workstream, auto-computed
// planned/executed/carry-over counts from the Log, merged with the
// qualitative fields (wins, priorities, help needed, spillover reasons)
// a workstream lead submits once a week via the mini weekly-note form.
// ---------------------------------------------------------------------
function getWeeklyUpdate(params) {
  const weekStart = params.weekStart ? new Date(params.weekStart) : mostRecentMonday();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 4); // Friday — work week is Mon-Fri, not Mon-Sun
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekEnd.getDate() + 4); // previous Friday

  const allRows = readLogRows();
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

function mostRecentMonday() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------
// Team Bandwidth (View 3 equivalent): hours logged per person per
// workstream for a date range, against a weekly capacity, so you can
// see who's over/under-loaded without a hand-built matrix.
// ---------------------------------------------------------------------
function getBandwidth(params) {
  const from = params.from ? new Date(params.from) : mostRecentMonday();
  const to = params.to ? new Date(params.to) : (() => {
    const d = new Date(from); d.setDate(d.getDate() + 4); return d; // Friday — Mon-Fri work week
  })();

  const rows = filterByDate(readLogRows(), from, to);
  const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
  // Capacity scales with the number of days actually in range, at
  // DAILY_CAPACITY_HOURS/day — a full Mon-Fri range (5 days) comes out
  // to exactly WEEKLY_CAPACITY_HOURS (40), rather than prorating against
  // a 7-day calendar week the way weekends-included ranges used to.
  const capacityHours = Math.round(days * DAILY_CAPACITY_HOURS * 10) / 10;

  const personMap = {};
  const workstreams = new Set();

  rows.forEach(r => {
    const person = r.submittedBy || 'Unassigned';
    const hours = parseFloat(r.actualHours) || 0;
    if (!personMap[person]) personMap[person] = { person, byWorkstream: {}, totalHours: 0 };
    personMap[person].byWorkstream[r.workstream] = (personMap[person].byWorkstream[r.workstream] || 0) + hours;
    personMap[person].totalHours += hours;
    workstreams.add(r.workstream);
  });

  const people = Object.values(personMap).map(p => {
    const executionPct = Math.min(100, Math.round((p.totalHours / capacityHours) * 100));
    return {
      person: p.person,
      byWorkstream: p.byWorkstream,
      totalHours: Math.round(p.totalHours * 10) / 10,
      executionPct: capacityHours ? executionPct : 0,
      bandwidthPct: capacityHours ? Math.max(0, 100 - executionPct) : 0
    };
  }).sort((a, b) => b.totalHours - a.totalHours);

  return {
    ok: true,
    from: Utilities.formatDate(from, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    to: Utilities.formatDate(to, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    capacityHours: capacityHours,
    workstreams: Array.from(workstreams),
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
