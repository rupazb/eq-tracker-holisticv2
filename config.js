// GIS Project Services — Status Tracker frontend config
//
// 1. Deploy apps-script.gs as a Web App (see README.md).
// 2. Paste the deployment URL below. It looks like:
//    https://script.google.com/macros/s/AKfycb.../exec
const API_URL = 'https://script.google.com/macros/s/AKfycbzPcMy2d6ECyvIHfIEO-6J0ph66j5Q-fxG3laueerA4fqpfnOb4tueb300AGJG5Rw5M/exec';

// Used only until the live Config tab loads (first paint, or if the
// network call fails). Keeps the form usable even offline for a moment.
// Edit the Config tab in the Sheet to change these for real — this is
// just a fallback mirror of the seed data.
const FALLBACK_CONFIG = {
  workstreams: [
    'Initial Strat - HIR',
    'Initial Stratification - NFMR',
    'Change Detections',
    'Restrat-HIR',
    'Fire Impact Assessment',
    'Survey Packages',
    'AD Survey Packages',
    'Ad-hoc',
    'WS1 - Paddock Mapping & Digitizing',
    'WS3: ALS to CPC',
    'Peer Review QA',
    'CarbonPlus',
    'AM Products QA',
    'Miscellaneous',
    'Training & KT'
  ],
  projectsByWorkstream: {
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
  },
  pocEQ: ['Rupaz', 'Radha', 'Nikhil', 'Yoga', 'Thoura'],
  pocGC: ['Chatura', 'Elissa', 'Emma', 'Ines', 'Kristie', 'Louise', 'Madeleine', 'Mary', 'Patrick Howie', 'Shanelle', 'Shannon', 'Vaibhav', 'Xavier', 'Silas', 'Sally'],
  // v3: "Blocked - EQ" renamed "Carry Over" (see apps-script.gs notes).
  statuses: ['In Progress', 'Blocked - GC', 'Carry Over', 'Delivered / Complete'],
  urgencies: ['Very High', 'High', 'Medium', 'Low', 'Nice to have', 'Unassigned'],
  // Stage/Step is free text on the form — these are just starting
  // suggestions (autocomplete), not an enforced list. It means something
  // different in every workstream, so it can't be a fixed dropdown.
  steps: ['Pre-processing', 'Product Update', 'Post Processing', 'CEA Segmentation', 'Peer Review QA', 'Testing Phase', 'Review', 'Final QA', 'Delivered'],
  // v3: added 'Audit Triggered Rework'. v3.2: added the two Training &
  // KT buckets.
  timeBuckets: ['Execution', 'QA / Review', 'Coordination / Waiting on GC', 'Admin / Meetings', 'Rework', 'Audit Triggered Rework', 'Training & KT - Given', 'Training & KT - Received'],
  // v3: workstream -> 'Ops' | 'R&D', used for the Bandwidth panel's
  // two-level split. Offline fallback only — live data comes from the
  // WorkstreamCategory tab.
  workstreamCategory: {
    'WS1 - Paddock Mapping & Digitizing': 'R&D',
    'WS3: ALS to CPC': 'R&D'
  },
  // v3: Step -> typical Est Hours, used to pre-fill the Est Hours field.
  // Offline fallback only — live data comes from the StepEstimates tab.
  stepEstimates: {
    'Pre-processing': 2, 'Product Update': 3, 'Post Processing': 4, 'Processing': 3,
    'CEA Segmentation': 4, 'Peer Review QA': 2, 'Testing Phase': 3, 'Review': 2.5,
    'Review Changes': 3, 'Final QA': 1, 'Delivered': 0.5
  }
};

// Same constants as the backend's bandwidth calc — used for the
// client-side capacity label before live data loads.
const WEEKLY_CAPACITY_HOURS = 40;

// Canonical status order — must match STATUS_OPTIONS in apps-script.gs.
// Used for the Board panel's column order.
const STATUS_OPTIONS = ['In Progress', 'Blocked - GC', 'Carry Over', 'Delivered / Complete'];

// v3: how far back the dashboard's Delivered section reaches by default
// before the "Show all" toggle is used. Must match
// DEFAULT_DELIVERED_WINDOW_DAYS in apps-script.gs.
const DEFAULT_DELIVERED_WINDOW_DAYS = 14;

// Status -> colour, used consistently across the form and dashboard
const STATUS_COLORS = {
  'In Progress': '#4F9EF8',
  'Blocked - GC': '#F0616B',
  'Carry Over': '#F2B84B',
  'Delivered / Complete': '#34D399'
};

// Risk level -> colour, used on the Risk panel
const RISK_COLORS = {
  'High': '#F0616B',
  'Medium': '#F2B84B',
  'Low': '#34D399'
};

// v3: category -> colour, used on the Bandwidth panel's R&D/Ops split
const CATEGORY_COLORS = {
  'Ops': '#4F9EF8',
  'R&D': '#A78BFA'
};

// v3.2: Given/Received -> colour, used on the Training Metrics panel
const TRAINING_COLORS = {
  'Given': '#4F9EF8',
  'Received': '#34D399'
};
