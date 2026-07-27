// App bootstrap and event wiring.

const App = {
  config: null,
  activeInsightPanel: 'overview',
  // Default both weekly-oriented panels to the most recently COMPLETED
  // week rather than the current (likely still-empty) one — you're
  // usually reporting on a week that just finished, not one in progress.
  weeklyWeekStart: addDaysISO(mostRecentMondayISO(), -7),
  bandwidthWeekStart: addDaysISO(mostRecentMondayISO(), -7),

  async init() {
    this.wireNav();
    this.wireInsightSegments();
    this.wireForm();
    this.wireWeeklyForm();
    this.wireBandwidthControls();
    this.wireDashboardControls();

    this.config = await Api.fetchConfig();
    if (this.config.offline) {
      showToast('Using saved project list — live config unavailable.', 'warn');
    }
    this.populateForm(this.config);
    this.populateWeeklyForm(this.config);
    this.restoreDraft();

    await this.refreshInsightPanel('overview');
  },

  // ---------------------------------------------------------------
  // Top-level nav: Log Update <-> Insights
  // ---------------------------------------------------------------
  wireNav() {
    qsa('.nav-button').forEach(btn => {
      btn.addEventListener('click', () => {
        qsa('.nav-button').forEach(b => b.classList.remove('nav-active'));
        qsa('.view').forEach(v => v.classList.remove('view-active'));
        btn.classList.add('nav-active');
        qs('#' + btn.dataset.view).classList.add('view-active');
        if (btn.dataset.view === 'view-insights') this.refreshInsightPanel(this.activeInsightPanel);
      });
    });
  },

  // ---------------------------------------------------------------
  // Insights sub-nav: Overview / Weekly / Bandwidth / Risk
  // ---------------------------------------------------------------
  wireInsightSegments() {
    qsa('.segment-button').forEach(btn => {
      btn.addEventListener('click', () => {
        qsa('.segment-button').forEach(b => b.classList.remove('segment-active'));
        qsa('.insight-panel').forEach(p => p.classList.remove('insight-panel-active'));
        btn.classList.add('segment-active');
        qs('#' + btn.dataset.panel).classList.add('insight-panel-active');
        this.activeInsightPanel = btn.dataset.panel.replace('panel-', '');
        this.refreshInsightPanel(this.activeInsightPanel);
      });
    });
  },

  async refreshInsightPanel(panel) {
    try {
      if (panel === 'overview') await this.refreshOverview();
      else if (panel === 'weekly') await this.refreshWeekly();
      else if (panel === 'bandwidth') await this.refreshBandwidth();
      else if (panel === 'risk') await this.refreshRisk();
    } catch (err) {
      showToast('Could not load data: ' + err.message, 'error');
    }
  },

  // ---------------------------------------------------------------
  // Daily form
  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // Daily form: one card per work item. entryCounter gives each card
  // a stable id so event delegation and draft save/restore can target
  // the right one even as cards are added/removed.
  // ---------------------------------------------------------------
  entryCounter: 0,

  populateForm(config) {
    const eqList = qs('#poc-eq-list');
    eqList.innerHTML = '';
    config.pocEQ.forEach(name => eqList.appendChild(el('option', { value: name })));

    const gcList = qs('#poc-gc-list');
    gcList.innerHTML = '';
    config.pocGC.forEach(name => gcList.appendChild(el('option', { value: name })));

    const stepList = qs('#step-suggestions');
    stepList.innerHTML = '';
    config.steps.forEach(name => stepList.appendChild(el('option', { value: name })));

    // start with one empty work-item card
    this.addEntryCard();
  },

  addEntryCard(prefill) {
    this.entryCounter++;
    const card = Render.entryCard(this.entryCounter, this.config);
    qs('#entries-container').appendChild(card);
    this.updateRemoveButtons();
    if (prefill) this.fillEntryCard(card, prefill);
    return card;
  },

  updateRemoveButtons() {
    const cards = qsa('.entry-card');
    qsa('.remove-entry-btn').forEach(btn => {
      btn.classList.toggle('hidden', cards.length <= 1);
    });
  },

  onEntryWorkstreamChange(card) {
    const ws = qs('.f-workstream', card).value;
    const projectSelect = qs('.f-project', card);
    const projects = (this.config.projectsByWorkstream[ws] || []);
    Render.populateSelect(projectSelect, projects, projects.length ? 'Select a project' : 'No projects yet — add one below');
    this.toggleNewProjectField(card, projects.length === 0);
  },

  toggleNewProjectField(card, isNew) {
    const wrap = qs('.new-project-wrap', card);
    const selectWrap = qs('.project-select-wrap', card);
    const addBtn = qs('.f-add-project', card);
    const projectSelect = qs('.f-project', card);
    const newProjectInput = qs('.f-new-project', card);

    wrap.classList.toggle('hidden', !isNew);
    selectWrap.classList.toggle('hidden', isNew);
    addBtn.classList.toggle('hidden', isNew);

    // Only one of these two fields should ever be "required" at a time —
    // leaving the hidden one required is what was blocking submission
    // with a silent native "please select an item" validation error.
    projectSelect.required = !isNew;
    newProjectInput.required = isNew;

    if (isNew) newProjectInput.focus();
  },

  wireForm() {
    const form = qs('#daily-form');
    qs('#field-date').value = todayISO();

    qs('#add-entry-btn').addEventListener('click', () => this.addEntryCard());

    // Event delegation: entries container's contents change over time,
    // so we bind once at the container and inspect e.target instead of
    // binding per-card (which would need rebinding on every add/remove).
    const container = qs('#entries-container');

    container.addEventListener('change', (e) => {
      const card = e.target.closest('.entry-card');
      if (!card) return;
      if (e.target.classList.contains('f-workstream')) this.onEntryWorkstreamChange(card);
    });

    container.addEventListener('click', (e) => {
      const card = e.target.closest('.entry-card');
      if (!card) return;
      if (e.target.classList.contains('f-add-project')) {
        this.toggleNewProjectField(card, true);
      }
      if (e.target.classList.contains('f-cancel-new-project')) {
        qs('.f-new-project', card).value = '';
        this.toggleNewProjectField(card, false);
      }
      if (e.target.classList.contains('remove-entry-btn')) {
        card.remove();
        this.updateRemoveButtons();
        this.saveCurrentDraft();
      }
    });

    form.addEventListener('input', debounce(() => this.saveCurrentDraft(), 400));
    container.addEventListener('change', debounce(() => this.saveCurrentDraft(), 200));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.submitForm();
    });
  },

  collectEntryData(card) {
    const usingNewProject = qs('.new-project-wrap', card).classList.contains('hidden') === false;
    const project = usingNewProject ? qs('.f-new-project', card).value.trim() : qs('.f-project', card).value;

    return {
      workstream: qs('.f-workstream', card).value,
      project: project,
      step: qs('.f-step', card).value.trim(),
      urgency: qs('.f-urgency', card).value,
      status: qs('.f-status', card).value,
      pocEQ: qs('.f-poc-eq', card).value.trim(),
      pocGC: qs('.f-poc-gc', card).value.trim(),
      update: qs('.f-update', card).value.trim(),
      nextStep: qs('.f-next-step', card).value.trim(),
      timeBucket: qs('.f-time-bucket', card).value,
      estHours: qs('.f-est-hours', card).value,
      actualHours: qs('.f-actual-hours', card).value,
      comments: qs('.f-comments', card).value.trim()
    };
  },

  fillEntryCard(card, data) {
    const map = {
      workstream: '.f-workstream', step: '.f-step', urgency: '.f-urgency', status: '.f-status',
      pocEQ: '.f-poc-eq', pocGC: '.f-poc-gc', update: '.f-update', nextStep: '.f-next-step',
      timeBucket: '.f-time-bucket', estHours: '.f-est-hours', actualHours: '.f-actual-hours',
      comments: '.f-comments'
    };
    if (data.workstream) {
      qs('.f-workstream', card).value = data.workstream;
      this.onEntryWorkstreamChange(card);
      if (data.project) {
        const knownProjects = this.config.projectsByWorkstream[data.workstream] || [];
        if (knownProjects.includes(data.project)) {
          qs('.f-project', card).value = data.project;
        } else {
          this.toggleNewProjectField(card, true);
          qs('.f-new-project', card).value = data.project;
        }
      }
    }
    Object.entries(map).forEach(([key, selector]) => {
      if (key === 'workstream') return;
      const node = qs(selector, card);
      if (node && data[key]) node.value = data[key];
    });
  },

  collectFormData() {
    return {
      date: qs('#field-date').value,
      submittedBy: qs('#field-submitted-by').value.trim(),
      entries: qsa('.entry-card').map(card => this.collectEntryData(card))
    };
  },

  saveCurrentDraft() {
    saveDraft(this.collectFormData());
  },

  restoreDraft() {
    const draft = loadDraft();
    if (!draft || !draft.entries || !draft.entries.length) return;

    if (draft.date) qs('#field-date').value = draft.date;
    if (draft.submittedBy) qs('#field-submitted-by').value = draft.submittedBy;

    // Clear the single default card and rebuild one per saved entry
    qs('#entries-container').innerHTML = '';
    draft.entries.forEach(entry => this.addEntryCard(entry));
  },

  async submitForm() {
    const data = this.collectFormData();

    if (!data.entries.length) {
      showToast('Add at least one work item.', 'error');
      return;
    }
    const invalidIndex = data.entries.findIndex(e => !e.workstream || !e.project || !e.status);
    if (invalidIndex !== -1) {
      showToast(`Work item ${invalidIndex + 1}: workstream, project, and status are required.`, 'error');
      return;
    }

    const btn = qs('#submit-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const result = await Api.submitEntry(data);
      const count = result.count || data.entries.length;
      showToast(`Logged ${count} update${count === 1 ? '' : 's'}. Thanks.`, 'success');
      clearDraft();
      qs('#entries-container').innerHTML = '';
      this.addEntryCard();
      qs('#field-date').value = todayISO();
    } catch (err) {
      showToast('Could not save: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log update';
    }
  },

  // ---------------------------------------------------------------
  // Overview panel
  // ---------------------------------------------------------------
  wireDashboardControls() {
    qs('#dashboard-refresh').addEventListener('click', () => this.refreshOverview());
    qs('#dashboard-range').addEventListener('change', () => this.refreshOverview());
  },

  async refreshOverview() {
    const range = qs('#dashboard-range').value;
    const params = {};
    if (range !== 'all') {
      const days = parseInt(range, 10);
      const from = new Date();
      from.setDate(from.getDate() - days);
      params.from = from.toISOString().slice(0, 10);
    }
    const data = await Api.fetchDashboard(params);
    Render.dashboard(data);
  },

  // ---------------------------------------------------------------
  // Weekly panel + note form
  // ---------------------------------------------------------------
  populateWeeklyForm(config) {
    Render.populateSelect(qs('#weekly-field-workstream'), config.workstreams, 'Select a workstream');
    qs('#weekly-field-week-start').value = mostRecentMondayISO();
  },

  wireWeeklyForm() {
    qs('#weekly-note-toggle').addEventListener('click', () => {
      qs('#weekly-note-form-wrap').classList.toggle('hidden');
    });

    qs('#weekly-note-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        weekStart: qs('#weekly-field-week-start').value,
        workstream: qs('#weekly-field-workstream').value,
        submittedBy: qs('#weekly-field-submitted-by').value.trim(),
        wins: qs('#weekly-field-wins').value.trim(),
        priorities: qs('#weekly-field-priorities').value.trim(),
        helpNeeded: qs('#weekly-field-help').value.trim(),
        reasonsForSpillover: qs('#weekly-field-reasons').value.trim()
      };
      if (!payload.workstream) {
        showToast('Pick a workstream for the weekly note.', 'error');
        return;
      }
      const btn = qs('#weekly-submit-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await Api.submitWeeklyNote(payload);
        showToast('Weekly note saved.', 'success');
        qs('#weekly-note-form').reset();
        qs('#weekly-field-week-start').value = mostRecentMondayISO();
        qs('#weekly-note-form-wrap').classList.add('hidden');
        this.refreshWeekly();
      } catch (err) {
        showToast('Could not save note: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save weekly note';
      }
    });

    qs('#weekly-prev-week').addEventListener('click', () => {
      this.weeklyWeekStart = addDaysISO(this.weeklyWeekStart, -7);
      this.refreshWeekly();
    });
    qs('#weekly-next-week').addEventListener('click', () => {
      this.weeklyWeekStart = addDaysISO(this.weeklyWeekStart, 7);
      this.refreshWeekly();
    });
  },

  async refreshWeekly() {
    qs('#weekly-range-label').textContent = weekRangeLabel(this.weeklyWeekStart);
    const data = await Api.fetchWeekly({ weekStart: this.weeklyWeekStart });
    Render.weekly(data);
  },

  // ---------------------------------------------------------------
  // Bandwidth panel
  // ---------------------------------------------------------------
  wireBandwidthControls() {
    qs('#bandwidth-prev-week').addEventListener('click', () => {
      this.bandwidthWeekStart = addDaysISO(this.bandwidthWeekStart, -7);
      this.refreshBandwidth();
    });
    qs('#bandwidth-next-week').addEventListener('click', () => {
      this.bandwidthWeekStart = addDaysISO(this.bandwidthWeekStart, 7);
      this.refreshBandwidth();
    });
  },

  async refreshBandwidth() {
    qs('#bandwidth-range-label').textContent = weekRangeLabel(this.bandwidthWeekStart);
    const from = this.bandwidthWeekStart;
    const to = addDaysISO(this.bandwidthWeekStart, 4);
    const data = await Api.fetchBandwidth({ from, to });
    Render.bandwidth(data);
  },

  // ---------------------------------------------------------------
  // Risk panel
  // ---------------------------------------------------------------
  async refreshRisk() {
    const data = await Api.fetchRisk();
    Render.risk(data.rows);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
