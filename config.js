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
    'Ad-hoc',
    'WS1 - Paddock Mapping & Digitizing',
    'WS3 - ALS to CPC',
    'Peer Review QA'
  ],
  projectsByWorkstream: {
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
  },
  pocEQ: ['Rupaz', 'Radha', 'Nikhil', 'Yoga', 'Thoura'],
  pocGC: ['Chatura', 'Elissa', 'Emma', 'Ines', 'Kristie', 'Louise', 'Madeleine', 'Mary', 'Patrick Howie', 'Shanelle', 'Shannon', 'Vaibhav', 'Xavier', 'Silas', 'Sally'],
  statuses: ['In Progress', 'Blocked - GC', 'Blocked - EQ', 'Delivered / Complete'],
  urgencies: ['Very High', 'High', 'Medium', 'Low', 'Nice to have', 'Unassigned'],
  // Stage/Step is free text on the form — these are just starting
  // suggestions (autocomplete), not an enforced list. It means something
  // different in every workstream, so it can't be a fixed dropdown.
  steps: ['Pre-processing', 'Product Update', 'Post Processing', 'CEA Segmentation', 'Peer Review QA', 'Testing Phase', 'Review', 'Final QA', 'Delivered'],
  timeBuckets: ['Execution', 'QA / Review', 'Coordination / Waiting on GC', 'Admin / Meetings', 'Rework']
};

// Same constants as the backend's bandwidth calc — used for the
// client-side capacity label before live data loads.
const WEEKLY_CAPACITY_HOURS = 40;

// Status -> colour, used consistently across the form and dashboard
const STATUS_COLORS = {
  'In Progress': '#4F9EF8',
  'Blocked - GC': '#F0616B',
  'Blocked - EQ': '#F2B84B',
  'Delivered / Complete': '#34D399'
};

// Risk level -> colour, used on the Risk panel
const RISK_COLORS = {
  'High': '#F0616B',
  'Medium': '#F2B84B',
  'Low': '#34D399'
};
