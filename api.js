// Thin wrapper around the Apps Script Web App.
//
// Requests are kept as "simple requests" (GET, or POST with a text/plain
// body) on purpose — Apps Script Web Apps don't handle CORS preflight
// (OPTIONS) requests, so a POST with a custom application/json header
// would fail silently in the browser. JSON.stringify(...) as the body
// with no explicit header defaults to text/plain, which avoids that.

const Api = {
  async fetchConfig() {
    try {
      const res = await fetch(`${API_URL}?action=config`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Config request failed');
      return data;
    } catch (err) {
      console.warn('Falling back to local config:', err);
      return { ok: true, ...FALLBACK_CONFIG, offline: true };
    }
  },

  async fetchDashboard(params) {
    const qsStr = new URLSearchParams({ action: 'dashboard', ...(params || {}) }).toString();
    const res = await fetch(`${API_URL}?${qsStr}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Dashboard request failed');
    return data;
  },

  async fetchRecentLog(limit) {
    const qsStr = new URLSearchParams({ action: 'log', limit: limit || 50 }).toString();
    const res = await fetch(`${API_URL}?${qsStr}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Log request failed');
    return data;
  },

  async submitEntry(payload) {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Submit failed');
    return data;
  },

  async fetchWeekly(params) {
    const qsStr = new URLSearchParams({ action: 'weekly', ...(params || {}) }).toString();
    const res = await fetch(`${API_URL}?${qsStr}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Weekly update request failed');
    return data;
  },

  async fetchBandwidth(params) {
    const qsStr = new URLSearchParams({ action: 'bandwidth', ...(params || {}) }).toString();
    const res = await fetch(`${API_URL}?${qsStr}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Bandwidth request failed');
    return data;
  },

  async fetchWeeklyDeliveries(params) {
    const qsStr = new URLSearchParams({ action: 'deliveries', ...(params || {}) }).toString();
    const res = await fetch(`${API_URL}?${qsStr}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Deliveries request failed');
    return data;
  },

  async fetchWeeklyCarryOvers(params) {
    const qsStr = new URLSearchParams({ action: 'carryovers', ...(params || {}) }).toString();
    const res = await fetch(`${API_URL}?${qsStr}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Carry-overs request failed');
    return data;
  },

  async fetchTrainingMetrics(params) {
    const qsStr = new URLSearchParams({ action: 'training', ...(params || {}) }).toString();
    const res = await fetch(`${API_URL}?${qsStr}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Training metrics request failed');
    return data;
  },

  async fetchRisk() {
    const res = await fetch(`${API_URL}?action=risk`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Risk request failed');
    return data;
  },

  async submitWeeklyNote(payload) {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ type: 'weekly', ...payload })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Submit failed');
    return data;
  },

  async fetchComments() {
    const res = await fetch(`${API_URL}?action=comments`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Comments request failed');
    return data;
  },

  async submitComment(payload) {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ type: 'comment', ...payload })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Submit failed');
    return data;
  }
};
