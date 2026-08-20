// All DOM-building lives here. app.js decides *when* to call these;
// this file only decides *how* to draw.

const Render = {
  populateSelect(select, options, placeholder) {
    const previousValue = select.value;
    select.innerHTML = '';
    if (placeholder) select.appendChild(el('option', { value: '', text: placeholder }));
    options.forEach(opt => select.appendChild(el('option', { value: opt, text: opt })));
    // Preserve whatever was already selected if it's still a valid option —
    // matters when this is called to silently refresh dropdowns in the
    // background (new Config sheet entries) while someone's mid-entry.
    if (previousValue && options.includes(previousValue)) {
      select.value = previousValue;
    }
  },

  statusChip(status) {
    const color = STATUS_COLORS[status] || '#7A8899';
    return el('span', {
      class: 'chip',
      style: `--chip-color:${color}`,
      text: status || 'Unknown'
    });
  },

  riskChip(level) {
    const color = RISK_COLORS[level] || '#7A8899';
    return el('span', {
      class: 'chip chip-sm',
      style: `--chip-color:${color}`,
      text: level || '—'
    });
  },

  categoryChip(category) {
    const color = CATEGORY_COLORS[category] || '#7A8899';
    return el('span', {
      class: 'chip chip-sm',
      style: `--chip-color:${color}`,
      text: category || 'Ops'
    });
  },

  // ---------------------------------------------------------------
  // Overview panel
  // ---------------------------------------------------------------
  dashboard(data) {
    this.summaryBar(data);
    this.statusBars(data.statusSplit, data.totalChecks);
    this.workstreamTable(data.byWorkstream);
    this.currentBoard(data.currentBoard);
    this.deliveredBoard(data.deliveredProjects || [], data.deliveredWindowDays);
    this.blockerCallout(data.blockers);
  },

  summaryBar(data) {
    const target = qs('#summary-bar');
    target.innerHTML = '';
    const projectCount = new Set(data.currentBoard.map(r => r.workstream + '||' + r.project)).size;
    const blockedGCCount = data.blockers.filter(b => b.status === 'Blocked - GC').length;
    const carryOverCount = data.blockers.filter(b => b.status === 'Carry Over').length;
    const deliveredPct = data.statusSplit.find(s => s.status === 'Delivered / Complete')?.pct || 0;

    const cards = [
      { label: 'Active projects', value: projectCount, accent: 'accent' },
      { label: 'Blocked on GC', value: blockedGCCount, accent: blockedGCCount > 0 ? 'danger' : 'accent' },
      { label: 'Carried over', value: carryOverCount, accent: carryOverCount > 0 ? 'danger' : 'accent' },
      { label: 'Delivered', value: deliveredPct + '%', accent: 'success' }
    ];
    cards.forEach(c => {
      target.appendChild(el('div', { class: `stat-card stat-card-${c.accent}` }, [
        el('div', { class: 'stat-value', text: String(c.value) }),
        el('div', { class: 'stat-label', text: c.label })
      ]));
    });
  },

  statusBars(statusSplit, total) {
    const target = qs('#status-bars');
    target.innerHTML = '';
    if (!total) {
      target.appendChild(this.emptyNote('No check-ins logged for this range yet.'));
      return;
    }
    statusSplit.forEach(s => {
      const row = el('div', { class: 'status-row' }, [
        el('div', { class: 'status-row-label' }, [
          this.statusChip(s.status),
          el('span', { class: 'status-row-count', text: `${s.count} · ${s.pct}%` })
        ]),
        el('div', { class: 'status-row-track' }, [
          el('div', { class: 'status-row-fill', style: `width:${s.pct}%; background:${STATUS_COLORS[s.status] || '#7A8899'}` })
        ])
      ]);
      target.appendChild(row);
    });
  },

  workstreamTable(rows) {
    const target = qs('#workstream-table');
    target.innerHTML = '';
    if (!rows.length) {
      target.appendChild(this.emptyNote('No data yet.'));
      return;
    }
    const wrap = el('div', { class: 'table-scroll' });
    const table = el('table', { class: 'data-table' });
    const thead = el('thead', {}, [
      el('tr', {}, ['Workstream', 'Projects', 'Blocked (GC)', 'Carry Over', 'In Progress', 'Delivered']
        .map(h => el('th', { text: h })))
    ]);
    const tbody = el('tbody');
    rows.forEach(r => {
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'cell-strong' }, [
          el('span', { text: r.workstream + ' ' }),
          this.categoryChip(r.category)
        ]),
        el('td', { text: String(r.distinctProjects) }),
        el('td', { text: String(r.blockedGC), class: r.blockedGC > 0 ? 'cell-warn' : '' }),
        el('td', { text: String(r.carryOver), class: r.carryOver > 0 ? 'cell-warn' : '' }),
        el('td', { text: String(r.inProgress) }),
        el('td', { text: String(r.delivered), class: r.delivered > 0 ? 'cell-good' : '' })
      ]));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    target.appendChild(wrap);
  },

  currentBoard(rows) {
    const target = qs('#current-board');
    target.innerHTML = '';
    if (!rows.length) {
      target.appendChild(this.emptyNote('No projects logged yet.'));
      return;
    }
    rows.forEach(r => {
      target.appendChild(el('div', { class: 'board-card' }, [
        el('div', { class: 'board-card-top' }, [
          el('span', { class: 'board-card-ws', text: r.workstream }),
          this.statusChip(r.status)
        ]),
        el('div', { class: 'board-card-project', text: r.project }),
        el('div', { class: 'board-card-meta', text: `${r.step || '—'} · EQ: ${r.pocEQ || '—'} · GC: ${r.pocGC || '—'}` }),
        r.update ? el('div', { class: 'board-card-update', text: r.update }) : null,
        r.status === 'Carry Over' && r.carryOverReason ? el('div', { class: 'board-card-update', text: `Carry over reason: ${r.carryOverReason}` }) : null,
        r.nextStep ? el('div', { class: 'board-card-next', text: `→ ${r.nextStep}` }) : null
      ].filter(Boolean)));
    });
  },

  deliveredBoard(rows, windowDays) {
    const target = qs('#delivered-board');
    if (!target) return; // guards against index.html not yet having this container
    target.innerHTML = '';
    if (!rows.length) {
      const label = windowDays === 'all' ? 'Nothing delivered yet.' : `Nothing delivered in the last ${windowDays} days.`;
      target.appendChild(this.emptyNote(label));
      return;
    }
    rows.forEach(r => {
      target.appendChild(el('div', { class: 'delivered-row' }, [
        el('div', {}, [
          el('span', { class: 'delivered-project', text: r.project }),
          el('span', { class: 'delivered-ws', text: ` — ${r.workstream}` })
        ]),
        el('span', { class: 'delivered-date', text: formatDateLabel(r.date) })
      ]));
    });
  },

  blockerCallout(blockers) {
    const target = qs('#blocker-callout');
    target.innerHTML = '';
    if (!blockers.length) {
      target.appendChild(this.emptyNote('Nothing currently blocked or carried over. Nice.'));
      return;
    }
    blockers.forEach(b => {
      target.appendChild(el('div', { class: 'blocker-row' }, [
        el('div', {}, [
          el('strong', { text: b.project }),
          el('span', { class: 'blocker-ws', text: ` — ${b.workstream}` })
        ]),
        el('div', { class: 'blocker-meta' }, [
          this.statusChip(b.status),
          el('span', { class: 'blocker-streak', text: `${b.streakDays} check-in${b.streakDays === 1 ? '' : 's'} running` })
        ]),
        b.status === 'Carry Over' && b.carryOverReason ? el('div', { class: 'blocker-next', text: `Reason: ${b.carryOverReason}` }) : null,
        b.nextStep ? el('div', { class: 'blocker-next', text: b.nextStep }) : null
      ].filter(Boolean)));
    });
  },

  // ---------------------------------------------------------------
  // Weekly panel
  // ---------------------------------------------------------------
  weekly(data) {
    qs('#weekly-range-label').textContent = `${formatDateLabel(data.weekStart)} – ${formatDateLabel(data.weekEnd)}`;
    const target = qs('#weekly-list');
    target.innerHTML = '';
    if (!data.workstreams.length) {
      target.appendChild(this.emptyNote('No activity logged for this week yet.'));
      return;
    }
    data.workstreams.forEach(w => {
      const card = el('div', { class: 'weekly-card' }, [
        el('div', { class: 'weekly-card-top' }, [
          el('span', { class: 'weekly-card-ws', text: w.workstream }),
          !w.noteSubmitted ? el('span', { class: 'chip chip-sm chip-muted', text: 'No note yet' }) : null
        ].filter(Boolean)),
        el('div', { class: 'weekly-stats' }, [
          this.weeklyStat('Planned', w.plannedCount),
          this.weeklyStat('Executed', w.executedCount, 'good'),
          this.weeklyStat('Carry over', w.carryOverCount, w.carryOverCount > 0 ? 'warn' : null)
        ])
      ]);
      if (w.wins) card.appendChild(this.weeklyNoteBlock('Wins', w.wins, 'good'));
      if (w.priorities) card.appendChild(this.weeklyNoteBlock('Priorities next week', w.priorities));
      if (w.helpNeeded) card.appendChild(this.weeklyNoteBlock('Help needed', w.helpNeeded, 'warn'));
      if (w.reasonsForSpillover) card.appendChild(this.weeklyNoteBlock('Why things spilled over', w.reasonsForSpillover, 'warn'));
      target.appendChild(card);
    });
  },

  weeklyStat(label, value, tone) {
    return el('div', { class: 'weekly-stat' + (tone ? ` weekly-stat-${tone}` : '') }, [
      el('div', { class: 'weekly-stat-value', text: String(value) }),
      el('div', { class: 'weekly-stat-label', text: label })
    ]);
  },

  weeklyNoteBlock(label, text, tone) {
    return el('div', { class: 'weekly-note' + (tone ? ` weekly-note-${tone}` : '') }, [
      el('div', { class: 'weekly-note-label', text: label }),
      el('div', { class: 'weekly-note-text', text: text })
    ]);
  },

  // ---------------------------------------------------------------
  // Delivered (weekly) panel — v3: "what got delivered this week, by
  // workstream", same week-nav pattern as Bandwidth.
  // ---------------------------------------------------------------
  weeklyDeliveries(data) {
    const target = qs('#deliveries-list');
    target.innerHTML = '';
    if (!data.workstreams.length) {
      target.appendChild(this.emptyNote('Nothing delivered this week yet.'));
      return;
    }
    data.workstreams.forEach(w => {
      target.appendChild(el('div', { class: 'weekly-card' }, [
        el('div', { class: 'weekly-card-top' }, [
          el('span', { class: 'weekly-card-ws', text: w.workstream }),
          this.categoryChip(w.category)
        ]),
        el('div', { class: 'delivered-project-list' },
          w.projects.map(p => el('div', { class: 'delivered-project-item', text: p }))
        )
      ]));
    });
  },

  // ---------------------------------------------------------------
  // Weekly Carry-Overs panel — direct counterpart to weeklyDeliveries:
  // project names logged as Carry Over that week, grouped by
  // workstream, with the reason shown under each project when given.
  // ---------------------------------------------------------------
  weeklyCarryOvers(data) {
    const target = qs('#carryovers-list');
    if (!target) return;
    target.innerHTML = '';
    if (!data.workstreams.length) {
      target.appendChild(this.emptyNote('Nothing carried over this week. Nice.'));
      return;
    }
    data.workstreams.forEach(w => {
      target.appendChild(el('div', { class: 'weekly-card' }, [
        el('div', { class: 'weekly-card-top' }, [
          el('span', { class: 'weekly-card-ws', text: w.workstream }),
          this.categoryChip(w.category)
        ]),
        el('div', { class: 'delivered-project-list' },
          w.projects.map(p => el('div', { class: 'carryover-project-item' }, [
            el('div', { class: 'carryover-project-name', text: p.project }),
            p.reason ? el('div', { class: 'carryover-project-reason', text: p.reason }) : null
          ].filter(Boolean)))
        )
      ]));
    });
  },

  // ---------------------------------------------------------------
  // Bandwidth panel
  // v3: team-wide R&D-vs-Ops split up top, then the existing per-person
  // / per-workstream breakdown below for drilling into Ops workstreams.
  // ---------------------------------------------------------------
  bandwidth(data) {
    qs('#bandwidth-range-label').textContent = `${formatDateLabel(data.from)} – ${formatDateLabel(data.to)} · capacity ${data.capacityHours}h/person`;

    const categoryTarget = qs('#bandwidth-category-split');
    if (categoryTarget) {
      categoryTarget.innerHTML = '';
      const totalHours = (data.categoryTotals || []).reduce((s, c) => s + c.hours, 0);
      if (!totalHours) {
        categoryTarget.appendChild(this.emptyNote('No hours logged for this range yet.'));
      } else {
        (data.categoryTotals || []).forEach(c => {
          categoryTarget.appendChild(el('div', { class: 'status-row' }, [
            el('div', { class: 'status-row-label' }, [
              this.categoryChip(c.category),
              el('span', { class: 'status-row-count', text: `${c.hours}h · ${c.pct}%` })
            ]),
            el('div', { class: 'status-row-track' }, [
              el('div', { class: 'status-row-fill', style: `width:${c.pct}%; background:${CATEGORY_COLORS[c.category] || '#7A8899'}` })
            ])
          ]));
        });
      }
    }

    const target = qs('#bandwidth-list');
    target.innerHTML = '';
    if (!data.people.length) {
      target.appendChild(this.emptyNote('No hours logged for this range yet.'));
      return;
    }
    data.people.forEach(p => {
      const overloaded = p.executionPct >= 100;
      const card = el('div', { class: 'bandwidth-card' }, [
        el('div', { class: 'bandwidth-top' }, [
          el('span', { class: 'bandwidth-name', text: p.person }),
          el('span', { class: 'bandwidth-hours', text: `${p.totalHours}h / ${data.capacityHours}h` })
        ]),
        el('div', { class: 'status-row-track bandwidth-track' }, [
          el('div', {
            class: 'status-row-fill',
            style: `width:${Math.min(100, p.executionPct)}%; background:${overloaded ? RISK_COLORS.High : 'var(--accent)'}`
          })
        ]),
        el('div', { class: 'bandwidth-meta', text: `${p.executionPct}% utilised${overloaded ? ' · over capacity' : ''} · R&D ${p.byCategory['R&D']}h / Ops ${p.byCategory['Ops']}h` }),
        this.bandwidthBreakdown(p.byWorkstream)
      ]);
      target.appendChild(card);
    });
  },

  bandwidthBreakdown(byWorkstream) {
    const entries = Object.entries(byWorkstream).filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return el('div');
    return el('div', { class: 'bandwidth-breakdown' },
      entries.map(([ws, hours]) => el('span', { class: 'breakdown-pill', text: `${ws} · ${Math.round(hours * 10) / 10}h` }))
    );
  },

  // ---------------------------------------------------------------
  // Training Metrics panel — hours spent giving vs receiving training,
  // per person, for the selected week. Same visual pattern as
  // Bandwidth: a team-wide split up top, per-person cards below.
  // ---------------------------------------------------------------
  trainingMetrics(data) {
    const splitTarget = qs('#training-split');
    if (splitTarget) {
      splitTarget.innerHTML = '';
      const totalHours = data.totals.givenHours + data.totals.receivedHours;
      if (!totalHours) {
        splitTarget.appendChild(this.emptyNote('No training logged for this week yet.'));
      } else {
        [
          { label: 'Given', hours: data.totals.givenHours, pct: data.totals.givenPct },
          { label: 'Received', hours: data.totals.receivedHours, pct: data.totals.receivedPct }
        ].forEach(t => {
          splitTarget.appendChild(el('div', { class: 'status-row' }, [
            el('div', { class: 'status-row-label' }, [
              el('span', { class: 'chip chip-sm', style: `--chip-color:${TRAINING_COLORS[t.label]}`, text: t.label }),
              el('span', { class: 'status-row-count', text: `${t.hours}h · ${t.pct}%` })
            ]),
            el('div', { class: 'status-row-track' }, [
              el('div', { class: 'status-row-fill', style: `width:${t.pct}%; background:${TRAINING_COLORS[t.label]}` })
            ])
          ]));
        });
      }
    }

    const target = qs('#training-list');
    target.innerHTML = '';
    if (!data.people.length) {
      target.appendChild(this.emptyNote('No training logged for this week yet.'));
      return;
    }
    data.people.forEach(p => {
      const givenPct = p.totalHours ? Math.round((p.givenHours / p.totalHours) * 100) : 0;
      target.appendChild(el('div', { class: 'bandwidth-card' }, [
        el('div', { class: 'bandwidth-top' }, [
          el('span', { class: 'bandwidth-name', text: p.person }),
          el('span', { class: 'bandwidth-hours', text: `${p.totalHours}h total` })
        ]),
        el('div', { class: 'status-row-track bandwidth-track' }, [
          el('div', { class: 'status-row-fill', style: `width:${givenPct}%; background:${TRAINING_COLORS.Given}` })
        ]),
        el('div', { class: 'bandwidth-meta', text: `Given ${p.givenHours}h · Received ${p.receivedHours}h` })
      ]));
    });
  },

  // ---------------------------------------------------------------
  // Risk panel
  // ---------------------------------------------------------------
  risk(rows) {
    const target = qs('#risk-grid');
    target.innerHTML = '';
    if (!rows.length) {
      target.appendChild(this.emptyNote('No risk data yet.'));
      return;
    }
    rows.forEach(r => {
      const card = el('div', { class: 'risk-card' }, [
        el('div', { class: 'risk-card-top' }, [
          el('span', { class: 'risk-card-ws', text: r['Workstream'] }),
          this.riskChip(r['Overall Control'])
        ]),
        el('div', { class: 'risk-attrs' }, [
          this.riskAttr('Documentation', r['Documentation Maturity']),
          this.riskAttr('Specialized skill', r['Specialized Expertise']),
          this.riskAttr('Process dependency', r['Process Dependency']),
          this.riskAttr('Transferability', r['Transferability']),
          this.riskAttr('Complexity', r['Overall Complexity']),
          this.riskAttr('Visibility', r['Visibility'])
        ])
      ]);
      target.appendChild(card);
    });
  },

  riskAttr(label, value) {
    return el('div', { class: 'risk-attr' }, [
      el('span', { class: 'risk-attr-label', text: label }),
      this.riskChip(value)
    ]);
  },

  // ---------------------------------------------------------------
  // Daily form: one card per work item (a person can touch several
  // workstreams in a day — one submission carries all of them)
  // ---------------------------------------------------------------
  entryCard(entryId, config) {
    const card = el('div', { class: 'entry-card', 'data-entry-id': String(entryId) });

    const wsSelect = el('select', { class: 'f-workstream', required: 'required' });
    this.populateSelect(wsSelect, config.workstreams, 'Select a workstream');

    const projectSelect = el('select', { class: 'f-project', required: 'required' });
    this.populateSelect(projectSelect, [], 'Pick a workstream first');

    const statusSelect = el('select', { class: 'f-status', required: 'required' });
    this.populateSelect(statusSelect, config.statuses, 'Select status');

    const urgencySelect = el('select', { class: 'f-urgency' });
    this.populateSelect(urgencySelect, config.urgencies, 'Select urgency');

    const timeBucketSelect = el('select', { class: 'f-time-bucket' });
    this.populateSelect(timeBucketSelect, config.timeBuckets, 'Optional');

    card.appendChild(el('div', { class: 'entry-card-top' }, [
      el('span', { class: 'entry-card-index', text: `Work item` }),
      el('button', { type: 'button', class: 'remove-entry-btn', text: 'Remove' })
    ]));

    card.appendChild(el('div', { class: 'field workstream-select-wrap' }, [
      el('label', { text: 'Workstream *' }), wsSelect
    ]));
    card.appendChild(el('button', { type: 'button', class: 'link-btn f-add-workstream', text: '+ Add a workstream not on this list' }));
    card.appendChild(el('div', { class: 'field hidden new-workstream-wrap' }, [
      el('label', { text: 'New workstream name *' }),
      el('input', { type: 'text', class: 'f-new-workstream', placeholder: 'Workstream name' }),
      el('button', { type: 'button', class: 'link-btn f-cancel-new-workstream', text: '← Choose from the list instead' })
    ]));

    card.appendChild(el('div', { class: 'field project-select-wrap' }, [
      el('label', { text: 'Project *' }), projectSelect
    ]));
    card.appendChild(el('button', { type: 'button', class: 'link-btn f-add-project', text: '+ Add a project not on this list' }));
    card.appendChild(el('div', { class: 'field hidden new-project-wrap' }, [
      el('label', { text: 'New project name *' }),
      el('input', { type: 'text', class: 'f-new-project', placeholder: 'Project name' }),
      el('button', { type: 'button', class: 'link-btn f-cancel-new-project', text: '← Choose from the list instead' })
    ]));

    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'Stage' }),
        el('input', { type: 'text', class: 'f-step', list: 'step-suggestions', placeholder: 'e.g. Post Processing — type anything' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Urgency' }), urgencySelect
      ])
    ]));

    card.appendChild(el('div', { class: 'field' }, [
      el('label', { text: 'Status *' }), statusSelect
    ]));

    // v3: shown only when Status = Carry Over — a short reason for the
    // spillover, since "Carry Over" replaced "Blocked - EQ" specifically
    // to pair the status with an explanation.
    card.appendChild(el('div', { class: 'field hidden carry-over-reason-wrap' }, [
      el('label', { text: 'Reason for carry over' }),
      el('textarea', { class: 'f-carry-over-reason', placeholder: 'Why this is carrying over instead of moving' })
    ]));

    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'POC — EQ' }),
        el('input', { type: 'text', class: 'f-poc-eq', list: 'poc-eq-list', placeholder: 'Name' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'POC — GC' }),
        el('input', { type: 'text', class: 'f-poc-gc', list: 'poc-gc-list', placeholder: 'Name' })
      ])
    ]));

    card.appendChild(el('div', { class: 'field' }, [
      el('label', { text: "Today's update" }),
      el('textarea', { class: 'f-update', placeholder: 'What happened today' })
    ]));

    card.appendChild(el('div', { class: 'field' }, [
      el('label', { text: 'Next step' }),
      el('textarea', { class: 'f-next-step', placeholder: 'What needs to happen next, and who owns it' })
    ]));

    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'Time bucket' }), timeBucketSelect
      ])
    ]));
    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'Est. hours' }),
        el('input', { type: 'number', class: 'f-est-hours', min: '0', step: '0.5', placeholder: 'Auto-fills from Stage' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Actual hours' }),
        el('input', { type: 'number', class: 'f-actual-hours', min: '0', step: '0.5' })
      ])
    ]));

    card.appendChild(el('div', { class: 'field' }, [
      el('label', { text: 'Comments (optional)' }),
      el('textarea', { class: 'f-comments' })
    ]));

    return card;
  },

  emptyNote(text) {
    return el('p', { class: 'empty-note', text });
  },

  // ---------------------------------------------------------------
  // Board panel (Kanban) — same currentBoard data as Overview, laid
  // out as status columns instead of a list. Read-only for now:
  // dragging to change status is a real workflow action, not a casual
  // reorder, so it needs a confirm step this version doesn't have yet.
  // ---------------------------------------------------------------
  board(currentBoard) {
    const target = qs('#board-columns');
    target.innerHTML = '';
    STATUS_OPTIONS.forEach(status => {
      const items = currentBoard.filter(r => r.status === status);
      const column = el('div', { class: 'board-column' }, [
        el('div', { class: 'board-column-header' }, [
          this.statusChip(status),
          el('span', { class: 'board-column-count', text: String(items.length) })
        ]),
        el('div', { class: 'board-column-cards' },
          items.length ? items.map(r => this.kanbanCard(r)) : [this.emptyNote('Nothing here.')]
        )
      ]);
      target.appendChild(column);
    });
  },

  kanbanCard(r) {
    return el('div', { class: 'kanban-card' }, [
      el('div', { class: 'kanban-card-ws', text: r.workstream }),
      el('div', { class: 'kanban-card-project', text: r.project }),
      el('div', { class: 'kanban-card-meta', text: `${r.step || '—'} · EQ: ${r.pocEQ || '—'} · GC: ${r.pocGC || '—'}` }),
      r.nextStep ? el('div', { class: 'kanban-card-next', text: `→ ${r.nextStep}` }) : null
    ].filter(Boolean));
  },

  // ---------------------------------------------------------------
  // GC View — a focused, read-mostly page: only what's currently
  // waiting on GC, with a comment thread per item so GC can confirm
  // or push back without needing Log write access. This is a UX-level
  // scoped view, not a security boundary (see apps-script.gs notes).
  // ---------------------------------------------------------------
  gcView(currentBoard, commentsByKey) {
    const target = qs('#gc-view-list');
    target.innerHTML = '';
    const blocked = currentBoard.filter(r => r.status === 'Blocked - GC');
    if (!blocked.length) {
      target.appendChild(this.emptyNote("Nothing waiting on GC right now — all caught up."));
      return;
    }
    blocked.forEach(r => {
      const key = r.workstream + '||' + r.project;
      const comments = commentsByKey[key] || [];
      target.appendChild(el('div', { class: 'gc-card' }, [
        el('div', { class: 'gc-card-top' }, [
          el('span', { class: 'gc-card-ws', text: r.workstream }),
          this.statusChip(r.status)
        ]),
        el('div', { class: 'gc-card-project', text: r.project }),
        el('div', { class: 'gc-card-meta', text: `Stage: ${r.step || '—'} · EQ contact: ${r.pocEQ || '—'}` }),
        r.update ? el('div', { class: 'gc-card-update', text: r.update }) : null,
        r.nextStep ? el('div', { class: 'gc-card-next', text: `Needed: ${r.nextStep}` }) : null,
        this.commentThread(comments),
        el('div', { class: 'gc-comment-form', 'data-key': key, 'data-workstream': r.workstream, 'data-project': r.project }, [
          el('textarea', { class: 'gc-comment-input', placeholder: 'Add an update or confirmation…' }),
          el('button', { type: 'button', class: 'gc-comment-submit', text: 'Post' })
        ])
      ].filter(Boolean)));
    });
  },

  commentThread(comments) {
    if (!comments.length) return el('div', { class: 'comment-thread-empty', text: 'No comments yet.' });
    return el('div', { class: 'comment-thread' }, comments.map(c =>
      el('div', { class: 'comment-row' }, [
        el('div', { class: 'comment-meta' }, [
          el('span', { class: 'comment-author', text: c.author || 'Someone' }),
          el('span', { class: 'comment-time', text: formatDateLabel(c.timestamp) })
        ]),
        el('div', { class: 'comment-text', text: c.comment })
      ])
    ));
  }
};
