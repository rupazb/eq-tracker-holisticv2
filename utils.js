// Small shared helpers, no dependencies.

function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (children || []).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// All the functions below work purely with "YYYY-MM-DD" calendar dates —
// no time-of-day, no local timezone involved in the arithmetic. Each date
// is anchored at UTC midnight internally (Date.UTC) and read back with
// UTC getters, so the result is identical regardless of the viewer's
// timezone.

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function mostRecentThursdayISO() {
  // v3: the work week runs Thursday through the following Wednesday
  // (Sat/Sun sit as off-days in the middle of that span), so every
  // weekly view anchors on the most recent Thursday instead of Monday.
  const today = todayISO();
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun ... 4 = Thu ... 6 = Sat
  const diff = (dow - 4 + 7) % 7;
  return addDaysISO(today, -diff);
}

function formatDateLabel(value) {
  if (!value) return '';
  let y, m, d;
  if (value instanceof Date) {
    if (isNaN(value)) return String(value);
    y = value.getFullYear(); m = value.getMonth() + 1; d = value.getDate();
  } else {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
      const parsed = new Date(value);
      return isNaN(parsed) ? String(value) : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function weekRangeLabel(startISO) {
  const endISO = addDaysISO(startISO, 6); // following Wednesday — Thu-Wed work week, Sat/Sun off in between
  return `${formatDateLabel(startISO)} – ${formatDateLabel(endISO)}`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Local draft, so a half-filled form on a spotty connection isn't lost.
const DRAFT_KEY = 'gis-tracker-draft';
function saveDraft(data) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
}

function showToast(message, kind) {
  const container = qs('#toast-container');
  if (!container) return;
  const node = el('div', { class: 'toast toast-' + (kind || 'info'), text: message });
  container.appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast-visible'));
  setTimeout(() => {
    node.classList.remove('toast-visible');
    setTimeout(() => node.remove(), 300);
  }, 3200);
}
