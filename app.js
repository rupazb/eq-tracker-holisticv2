// App bootstrap and event wiring.

const App = {
  config: null,
  activeInsightPanel: 'overview',
  // v3: every weekly-oriented panel defaults to the CURRENT week (Thu
  // through today) rather than the last completed one — Thursday is the
  // work week's anchor now, not Monday (see mostRecentThursdayISO in
  // utils.js).
  weeklyWeekStart: mostRecentThursdayISO(),
  bandwidthWeekStart: mostRecentThursdayISO(),
  deliveriesWeekStart: mostRecentThursdayISO(),
  trainingWeekStart: mostRecentThursdayISO(),
  // v3: dashboard's Delivered section defaults to a recent window;
  // "Show all" flips this to 'all'.
  deliveredDays: String(DEFAULT_DELIVERED_WINDOW_DAYS),

  async init() {
    this.wireNav();
    this.wireInsightSegments();
    this.wireForm();
    this.wireWeeklyForm();
    this.wireBandwidthControls();
    this.wireDeliveriesControls();
    this.wireTrainingControls();
    this.wireDashboardControls();

    this.config = await Api.fetchConfig();
    if (this.config.offline) {
      showToast('Using saved project list — live config unavailable.', 'warn');
    }
    this.populateForm(this.config);
    this.populateWeeklyForm(this.config);
    this.restoreDraft();
    this.wireConfigRefresh();
    this.startConfigAutoRefresh();
    this.wireGCView();

    await this.refreshInsightPanel('overview');
  },

  // ---------------------------------------------------------------
  // Config sheet <-> dropdown sync. Adding a workstream/project/POC
  // directly in the Config sheet (not just through "+ Add..." in the
  // form) shows up here too — polled in the background, plus a manual
  // refresh button for "I just added it, show me now."
  // ---------------------------------------------------------------
  wireConfigRefresh() {
    const btn = qs('#refresh-config-btn');
    if (btn) btn.addEventListener('click', () => this.refreshConfigSilently(true));
  },

  startConfigAutoRefresh() {
    setInterval(() => this.refreshConfigSilently(false), 2 * 60 * 1000); // every 2 min
  },

  async refreshConfigSilently(showFeedback) {
    try {
      const fresh = await Api.fetchConfig();
      if (fresh.offline) {
        if (showFeedback) showToast('Could not refresh — using saved list.', 'warn');
        return;
      }
      this.applyRefreshedConfig(fresh);
      if (showFeedback) showToast('Dropdown options refreshed.', 'success');
    } catch (err) {
      if (showFeedback) showToast('Could not refresh options: ' + err.message, 'error');
    }
  },

  applyRefreshedConfig(freshConfig) {
    this.config = freshConfig;

    const eqList = qs('#poc-eq-list');
    eqList.innerHTML = '';
    freshConfig.pocEQ.forEach(name => eqList.appendChild(el('option', { value: name })));

    const gcList = qs('#poc-gc-list');
    gcList.innerHTML = '';
    freshConfig.pocGC.forEach(name => gcList.appendChild(el('option', { value: name })));

    const stepList = qs('#step-suggestions');
    if (stepList) {
      stepList.innerHTML = '';
      freshConfig.steps.forEach(name => stepList.appendChild(el('option', { value: name })));
    }

    // Refresh each existing card's dropdowns in place — but never touch a
    // card that's mid-"add new workstream/project", so nobody's half-typed
    // entry gets yanked out from under them by a background refresh.
    qsa('.entry-card').forEach(card => {
      const inNewWorkstreamMode = !qs('.new-workstream-wrap', card).classList.contains('hidden');
      if (inNewWorkstreamMode) return;

      const wsSelect = qs('.f-workstream', card);
      Render.populateSelect(wsSelect, freshConfig.workstreams, 'Select a workstream');

      const inNewProjectMode = !qs('.new-project-wrap', card).classList.contains('hidden');
      if (inNewProjectMode) return;

      const ws = wsSelect.value;
      if (!ws) return;
      const projectSelect = qs('.f-project', card);
      const projects = freshConfig.projectsByWorkstream[ws] || [];
      Render.populateSelect(projectSelect, projects, projects.length ? 'Select a project' : 'No projects yet — add one below');
    });

    const weeklyWsSelect = qs('#weekly-field-workstream');
    if (weeklyWsSelect) Render.populateSelect(weeklyWsSelect, freshConfig.workstreams, 'Select a workstream');
  },

  // ---------------------------------------------------------------
  // Top-level nav: Log Update <-> Insights <-> GC View
  // ---------------------------------------------------------------
  wireNav() {
    qsa('.nav-button').forEach(btn => {
      btn.addEventListener('click', () => {
        qsa('.nav-button').forEach(b => b.classList.remove('nav-active'));
        qsa('.view').forEach(v => v.classList.remove('view-active'));
        btn.classList.add('nav-active');
        qs('#' + btn.dataset.view).classList.add('view-active');
        if (btn.dataset.view === 'view-insights') this.refreshInsightPanel(this.activeInsightPanel);
        if (btn.dataset.view === 'view-gc') this.refreshGCView();
      });
    });
  },

  // ---------------------------------------------------------------
  // Insights sub-nav: Overview / Weekly / Bandwidth / Delivered / Board / Risk
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
      else if (panel === 'delivered') await this.refreshDeliveries();
      else if (panel === 'training') await this.refreshTrainingMetrics();
      else if (panel === 'board') await this.refreshBoard();
      else if (panel === 'risk') await this.refreshRisk();
    } catch (err) {
      showToast('Could not load data: ' + err.message, 'error');
    }
  },

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

  toggleNewWorkstreamField(card, isNew) {
    const wrap = qs('.new-workstream-wrap', card);
    const selectWrap = qs('.workstream-select-wrap', card);
    const addBtn = qs('.f-add-workstream', card);
    const wsSelect = qs('.f-workstream', card);
    const newWorkstreamInput = qs('.f-new-workstream', card);

    wrap.classList.toggle('hidden', !isNew);
    selectWrap.classList.toggle('hidden', isNew);
    addBtn.classList.toggle('hidden', isNew);

    // Same one-required-at-a-time rule as the project fields — the
    // hidden one must not stay required or submission silently fails.
    wsSelect.required = !isNew;
    newWorkstreamInput.required = isNew;

    if (isNew) {
      newWorkstreamInput.focus();
      // A brand-new workstream can't have any known projects yet, so
      // the project field should behave exactly as if an existing
      // workstream with zero projects had been picked.
      const projectSelect = qs('.f-project', card);
      Render.populateSelect(projectSelect, [], 'No projects yet — add one below');
      this.toggleNewProjectField(card, true);
    }
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

  // v3: Status = Carry Over shows a "reason for carry over" field;
  // anything else hides it (and clears it, so a stale reason from an
  // earlier status pick never gets silently submitted).
  toggleCarryOverField(card) {
    const status = qs('.f-status', card).value;
    const wrap = qs('.carry-over-reason-wrap', card);
    if (!wrap) return;
    const isCarryOver = status === 'Carry Over';
    wrap.classList.toggle('hidden', !isCarryOver);
    if (!isCarryOver) qs('.f-carry-over-reason', card).value = '';
  },

  // v3: pre-fill Est Hours from the Step -> typical hours lookup, but
  // only if the person hasn't already typed something themselves —
  // never overwrite a value they entered.
  maybePrefillEstHours(card) {
    const step = qs('.f-step', card).value.trim();
    const estHoursInput = qs('.f-est-hours', card);
    if (!step || estHoursInput.value !== '') return;
    const estimate = (this.config.stepEstimates || {})[step];
    if (estimate !== undefined) estHoursInput.value = estimate;
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
      if (e.target.classList.contains('f-status')) this.toggleCarryOverField(card);
    });

    container.addEventListener('blur', (e) => {
      if (!e.target.classList || !e.target.classList.contains('f-step')) return;
      const card = e.target.closest('.entry-card');
      if (card) this.maybePrefillEstHours(card);
    }, true);

    container.addEventListener('click', (e) => {
      const card = e.target.closest('.entry-card');
      if (!card) return;
      if (e.target.classList.contains('f-add-workstream')) {
        this.toggleNewWorkstreamField(card, true);
      }
      if (e.target.classList.contains('f-cancel-new-workstream')) {
        qs('.f-new-workstream', card).value = '';
        this.toggleNewWorkstreamField(card, false);
        this.onEntryWorkstreamChange(card);
      }
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
    const usingNewWorkstream = qs('.new-workstream-wrap', card).classList.contains('hidden') === false;
    const workstream = usingNewWorkstream ? qs('.f-new-workstream', card).value.trim() : qs('.f-workstream', card).value;

    const usingNewProject = qs('.new-project-wrap', card).classList.contains('hidden') === false;
    const project = usingNewProject ? qs('.f-new-project', card).value.trim() : qs('.f-project', card).value;

    return {
      workstream: workstream,
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
      comments: qs('.f-comments', card).value.trim(),
      carryOverReason: qs('.f-carry-over-reason', card) ? qs('.f-carry-over-reason', card).value.trim() : ''
    };
  },

  fillEntryCard(card, data) {
    const map = {
      workstream: '.f-workstream', step: '.f-step', urgency: '.f-urgency', status: '.f-status',
      pocEQ: '.f-poc-eq', pocGC: '.f-poc-gc', update: '.f-update', nextStep: '.f-next-step',
      timeBucket: '.f-time-bucket', estHours: '.f-est-hours', actualHours: '.f-actual-hours',
      comments: '.f-comments', carryOverReason: '.f-carry-over-reason'
    };
    if (data.workstream) {
      const knownWorkstreams = this.config.workstreams || [];
      if (knownWorkstreams.includes(data.workstream)) {
        qs('.f-workstream', card).value = data.workstream;
        this.onEntryWorkstreamChange(card);
      } else {
        this.toggleNewWorkstreamField(card, true);
        qs('.f-new-workstream', card).value = data.workstream;
      }
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
    this.toggleCarryOverField(card);
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

    if (!data.submittedBy) {
      showToast('Your name is required before submitting.', 'error');
      qs('#field-submitted-by').focus();
      return;
    }
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
    const showAllBtn = qs('#delivered-show-all');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        this.deliveredDays = this.deliveredDays === 'all' ? String(DEFAULT_DELIVERED_WINDOW_DAYS) : 'all';
        showAllBtn.textContent = this.deliveredDays === 'all'
          ? `Show last ${DEFAULT_DELIVERED_WINDOW_DAYS} days`
          : 'Show all';
        this.refreshOverview();
      });
    }
  },

  async refreshOverview() {
    const range = qs('#dashboard-range').value;
    const params = { deliveredDays: this.deliveredDays };
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
    qs('#weekly-field-week-start').value = mostRecentThursdayISO();
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
      if (!payload.submittedBy) {
        showToast('Your name is required before submitting.', 'error');
        qs('#weekly-field-submitted-by').focus();
        return;
      }
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
        qs('#weekly-field-week-start').value = mostRecentThursdayISO();
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
  // Delivered / Carried-over (weekly) panel — v3
  // ---------------------------------------------------------------
  wireDeliveriesControls() {
    const prev = qs('#deliveries-prev-week');
    const next = qs('#deliveries-next-week');
    if (prev) prev.addEventListener('click', () => {
      this.deliveriesWeekStart = addDaysISO(this.deliveriesWeekStart, -7);
      this.refreshDeliveries();
    });
    if (next) next.addEventListener('click', () => {
      this.deliveriesWeekStart = addDaysISO(this.deliveriesWeekStart, 7);
      this.refreshDeliveries();
    });
  },

  async refreshDeliveries() {
    const label = qs('#deliveries-range-label');
    const [delivered, carriedOver] = await Promise.all([
      Api.fetchWeeklyDeliveries({ weekStart: this.deliveriesWeekStart }),
      Api.fetchWeeklyCarryOvers({ weekStart: this.deliveriesWeekStart })
    ]);
    if (label) {
      label.textContent = `${weekRangeLabel(this.deliveriesWeekStart)} · ${delivered.totalDelivered} delivered · ${carriedOver.totalCarriedOver} carried over`;
    }
    Render.weeklyDeliveries(delivered);
    Render.weeklyCarryOvers(carriedOver);
  },

  // ---------------------------------------------------------------
  // Training Metrics panel — v3.2
  // ---------------------------------------------------------------
  wireTrainingControls() {
    const prev = qs('#training-prev-week');
    const next = qs('#training-next-week');
    if (prev) prev.addEventListener('click', () => {
      this.trainingWeekStart = addDaysISO(this.trainingWeekStart, -7);
      this.refreshTrainingMetrics();
    });
    if (next) next.addEventListener('click', () => {
      this.trainingWeekStart = addDaysISO(this.trainingWeekStart, 7);
      this.refreshTrainingMetrics();
    });
  },

  async refreshTrainingMetrics() {
    const label = qs('#training-range-label');
    if (label) label.textContent = weekRangeLabel(this.trainingWeekStart);
    const data = await Api.fetchTrainingMetrics({ weekStart: this.trainingWeekStart });
    Render.trainingMetrics(data);
  },

  // ---------------------------------------------------------------
  // Risk panel
  // ---------------------------------------------------------------
  async refreshRisk() {
    const data = await Api.fetchRisk();
    Render.risk(data.rows);
  },

  // ---------------------------------------------------------------
  // Board panel (Kanban) — reuses the same all-time currentBoard data
  // as Overview, just laid out as status columns.
  // ---------------------------------------------------------------
  async refreshBoard() {
    const data = await Api.fetchDashboard({ deliveredDays: 'all' });
    Render.board(data.currentBoard);
  },

  // ---------------------------------------------------------------
  // GC View — focused list of everything currently blocked on GC,
  // with a comment thread per item.
  // ---------------------------------------------------------------
  wireGCView() {
    const list = qs('#gc-view-list');
    if (!list) return;

    list.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('gc-comment-submit')) return;
      const formWrap = e.target.closest('.gc-comment-form');
      const textarea = qs('.gc-comment-input', formWrap);
      const comment = textarea.value.trim();
      if (!comment) return;

      const author = (qs('#gc-view-author')?.value || '').trim();
      if (!author) {
        showToast('Your name is required before posting a comment.', 'error');
        qs('#gc-view-author')?.focus();
        return;
      }
      e.target.disabled = true;
      try {
        await Api.submitComment({
          workstream: formWrap.dataset.workstream,
          project: formWrap.dataset.project,
          author: author,
          comment: comment
        });
        textarea.value = '';
        showToast('Comment posted.', 'success');
        await this.refreshGCView();
      } catch (err) {
        showToast('Could not post comment: ' + err.message, 'error');
      } finally {
        e.target.disabled = false;
      }
    });

    const refreshBtn = qs('#gc-view-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshGCView());
  },

  async refreshGCView() {
    try {
      const [dashboard, comments] = await Promise.all([
        Api.fetchDashboard({ deliveredDays: 'all' }),
        Api.fetchComments()
      ]);
      const commentsByKey = {};
      comments.rows.forEach(c => {
        const key = c.workstream + '||' + c.project;
        if (!commentsByKey[key]) commentsByKey[key] = [];
        commentsByKey[key].push(c);
      });
      Render.gcView(dashboard.currentBoard, commentsByKey);
    } catch (err) {
      showToast('Could not load GC view: ' + err.message, 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
