  const tabs = document.querySelectorAll('.tabs button');
  const panels = {
    paste: document.getElementById('paste-panel'),
    scan: document.getElementById('scan-panel'),
  };
  tabs.forEach(btn => btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.entries(panels).forEach(([k, el]) => el.hidden = (k !== btn.dataset.mode));
  }));

  const $ = id => document.getElementById(id);
  const errorBox = $('error-box');
  const result = $('result');

  function showError(message) {
    result.hidden = true;
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function clearError() { errorBox.hidden = true; errorBox.textContent = ''; }

  function gradeClass(grade) {
    if (grade === 'A+') return 'grade-Aplus';
    return 'grade-' + grade;
  }

  function renderResult(data) {
    clearError();
    result.hidden = false;

    $('r-score').textContent = data.score.overall;
    $('r-score').className = 'value ' + gradeClass(data.score.grade);
    $('r-grade').textContent = data.score.grade;

    $('r-findings').textContent = data.findings.length;
    $('r-critical').textContent = data.score.criticalCount + ' critical';

    $('r-tokens').textContent = (data.discovery?.alwaysLoadedTokens ?? 0).toLocaleString();
    $('r-waste').textContent = data.score.estimatedTokenWaste.toLocaleString();
    $('r-waste-pct').textContent = data.score.estimatedTokenSavingsPercentage + '% of analyzed tokens';

    const dimRows = data.score.dimensions.map(d => `
      <tr>
        <td>${escape(d.dimension)}</td>
        <td>${d.score}</td>
        <td>${Math.round(d.weight * 100)}%</td>
        <td>${escape(d.summary)}</td>
      </tr>`).join('');
    $('r-dimensions').innerHTML = dimRows;

    const findings = data.findings.slice().sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    const findingRows = findings.map(f => `
      <tr>
        <td><code>${escape(f.ruleId)}</code></td>
        <td><span class="pill sev-${escape(f.severity)}">${escape(f.severity)}</span></td>
        <td><code>${escape(f.file)}</code>${f.line ? ' :' + f.line : ''}</td>
        <td>${escape(f.message)}${f.suggestion ? `<div class="hint">↳ ${escape(f.suggestion)}</div>` : ''}</td>
      </tr>`).join('');
    $('r-finding-rows').innerHTML = findingRows || '<tr><td colspan="4" style="text-align:center;color:var(--good);">No findings — clean run 🎉</td></tr>';
  }

  function severityRank(s) {
    return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s] ?? 99;
  }
  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[ch]));
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!res.ok) throw new Error(data?.error ? `${data.error}: ${JSON.stringify(data.details ?? '')}` : `HTTP ${res.status}`);
    return data;
  }

  // ─── Rule/dimension toggle drawer ────────────────────────────────────────
  const DIMENSIONS = [
    'security',
    'token-efficiency',
    'specificity',
    'completeness',
    'conflict-reachability',
    'harness-quality',
  ];
  const toggleState = {
    rules: {},      // ruleId -> false (disabled)
    dimensions: {}, // dimension -> false (disabled)
  };
  let ruleCatalog = [];

  async function loadRuleCatalog() {
    try {
      const res = await fetch('/api/rules');
      const data = await res.json();
      ruleCatalog = data.rules ?? [];
      renderDrawer();
    } catch (err) {
      console.warn('Failed to load /api/rules; toggles disabled', err);
    }
  }

  function renderDrawer() {
    const dimBar = document.getElementById('dim-bar');
    dimBar.innerHTML = DIMENSIONS.map(d => {
      const off = toggleState.dimensions[d] === false;
      return `<button type="button" class="${off ? 'dim-off' : ''}" data-dim="${d}">${off ? '⏻ ' : ''}${d}${off ? ' (off)' : ''}</button>`;
    }).join('');
    dimBar.querySelectorAll('button[data-dim]').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.dim;
        if (toggleState.dimensions[d] === false) delete toggleState.dimensions[d];
        else toggleState.dimensions[d] = false;
        renderDrawer();
      });
    });

    const groups = {};
    for (const r of ruleCatalog) (groups[r.dimension] ||= []).push(r);
    const groupsEl = document.getElementById('rule-groups');
    groupsEl.innerHTML = DIMENSIONS
      .filter(d => groups[d])
      .map(d => {
        const dimOff = toggleState.dimensions[d] === false;
        const items = groups[d]
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(r => {
            const ruleOff = toggleState.rules[r.id] === false;
            const effectiveOff = ruleOff || (dimOff && toggleState.rules[r.id] !== true);
            return `<label class="${effectiveOff ? 'disabled' : ''}" title="${escape(r.title)}">
              <input type="checkbox" data-rule="${r.id}" ${effectiveOff ? '' : 'checked'} />
              <code>${r.id}</code> <span style="color:var(--muted);font-size:11px;">${escape(severityShort(r.severity))}</span>
            </label>`;
          })
          .join('');
        return `<div class="rule-group">
          <h3>${escape(d)}</h3>
          <div class="rule-grid">${items}</div>
        </div>`;
      })
      .join('');
    groupsEl.querySelectorAll('input[data-rule]').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.dataset.rule;
        if (input.checked) {
          delete toggleState.rules[id];
          // If a dimension is disabled but the user re-enabled this rule,
          // record an explicit enable so the server overrides the dim toggle.
          const r = ruleCatalog.find(x => x.id === id);
          if (r && toggleState.dimensions[r.dimension] === false) {
            toggleState.rules[id] = true;
          }
        } else {
          toggleState.rules[id] = false;
        }
        renderDrawer();
      });
    });
  }

  function severityShort(s) {
    return ({ critical: 'CRIT', high: 'HIGH', medium: 'MED', low: 'LOW', info: 'INFO' })[s] ?? s;
  }

  function policyPayload() {
    const rules = {};
    for (const [id, v] of Object.entries(toggleState.rules)) {
      rules[id] = { enabled: v };
    }
    const dimensions = {};
    for (const [d, v] of Object.entries(toggleState.dimensions)) {
      dimensions[d] = { enabled: v };
    }
    if (Object.keys(rules).length === 0 && Object.keys(dimensions).length === 0) return undefined;
    const policy = {};
    if (Object.keys(rules).length) policy.rules = rules;
    if (Object.keys(dimensions).length) policy.dimensions = dimensions;
    return policy;
  }

  function toCatesYaml() {
    const lines = ['# Generated by the CATES Service drawer'];
    const dims = Object.entries(toggleState.dimensions);
    if (dims.length) {
      lines.push('dimensions:');
      for (const [d, v] of dims) lines.push(`  ${d}: ${v === false ? 'off' : 'on'}`);
    }
    const rules = Object.entries(toggleState.rules);
    if (rules.length) {
      lines.push('rules:');
      for (const [id, v] of rules) lines.push(`  ${id}: ${v === false ? 'off' : 'on'}`);
    }
    if (lines.length === 1) lines.push('# No toggles set. Default policy is in effect.');
    return lines.join('\n');
  }

  document.getElementById('reset-toggles').addEventListener('click', () => {
    toggleState.rules = {};
    toggleState.dimensions = {};
    renderDrawer();
    document.getElementById('yml-preview').hidden = true;
  });
  document.getElementById('export-yml').addEventListener('click', () => {
    document.getElementById('yml-text').textContent = toCatesYaml();
    document.getElementById('yml-preview').hidden = false;
  });
  document.getElementById('copy-yml').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(toCatesYaml());
      const status = document.getElementById('yml-status');
      status.textContent = 'Copied!';
      setTimeout(() => (status.textContent = ''), 1500);
    } catch (err) {
      document.getElementById('yml-text').textContent = toCatesYaml();
      document.getElementById('yml-preview').hidden = false;
    }
  });

  loadRuleCatalog();

  $('run-paste').addEventListener('click', async () => {
    const content = $('paste-content').value;
    const path = $('paste-type').value;
    if (!content.trim()) return showError('Paste some content first.');
    const btn = $('run-paste'); btn.disabled = true; $('paste-status').textContent = 'Scoring…';
    try {
      const body = { files: [{ path, content }] };
      const policy = policyPayload();
      if (policy) body.policy = policy;
      const data = await postJson('/api/analyze', body);
      renderResult(data);
    } catch (err) {
      showError(String(err.message ?? err));
    } finally {
      btn.disabled = false; $('paste-status').textContent = '';
    }
  });

  $('run-scan').addEventListener('click', async () => {
    const url = $('scan-url').value.trim();
    if (!url) return showError('Enter a GitHub URL first.');
    const btn = $('run-scan'); btn.disabled = true; $('scan-status').textContent = 'Cloning + scoring (this can take a few seconds)…';
    try {
      const body = { url };
      const policy = policyPayload();
      if (policy) body.policy = policy;
      const data = await postJson('/api/scan', body);
      renderResult(data);
    } catch (err) {
      showError(String(err.message ?? err));
    } finally {
      btn.disabled = false; $('scan-status').textContent = '';
    }
  });
