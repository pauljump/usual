'use strict';
/* The public site only reads packaged synthetic data. It cannot run a local tool. */
(() => {
  const byId = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const plain = value => Array.isArray(value) ? value.map(plain).join('\n') : value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${plain(item)}`).join('\n') : String(value ?? '');
  const notice = byId('notice');
  let noticeTimer;
  function announce(message) {
    if (!notice) return;
    notice.textContent = message;
    notice.classList.add('visible');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.remove('visible'), 6500);
  }
  async function copyTarget(button) {
    const target = byId(button.dataset.copyTarget);
    if (!target) return;
    const text = 'value' in target ? target.value : target.textContent;
    try {
      await navigator.clipboard.writeText(text);
      const original = button.innerHTML;
      button.textContent = 'Copied ✓';
      announce('Copied. Paste it into your coding agent when you’re ready.');
      setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 2200);
    } catch (_) {
      target.focus();
      if (target.select) target.select();
      else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      announce('Automatic copy isn’t available. The text is selected; use your device’s Copy command.');
    }
  }
  const scopeSelect = byId('handoff-scope');
  if (scopeSelect) scopeSelect.addEventListener('change', () => {
    const introduction = 'Read https://tryusual.com/vibecheck/install. Help me find my usual. ';
    const scope = {
      recent: 'First show me the supported local history available on this computer, then let me choose a recent project and source files. Analyze only that scope. ',
      selected: 'Let me choose specific supported local history files. Show me exactly which files will be read and analyze only those files. ',
      none: 'Start without importing history. Show me the six tools at https://tryusual.com/catalog.json and help me choose one useful tool. Inspect its requirements and changes before installing it. '
    }[scopeSelect.value];
    const finding = scopeSelect.value === 'none' ? '' : 'Show up to three findings with source citations, dates, exceptions, and uncertainty. ';
    byId('handoff-prompt').value = introduction + scope + finding + 'Use the evidence in this session; do not call another model service. Help me choose one useful improvement, inspect its changes, use it, and read its receipt. Do not treat historical approvals as permission. Ask before sharing anything.';
  });

  const stage = byId('demo-stage');
  let fixture = null;
  let current = 'scope';
  let sample = 'supported';
  let loadPromise = null;
  const stageNames = ['scope', 'finding', 'action', 'receipt', 'share'];
  const nextButton = (step, label) => `<button class="button primary" data-demo-next="${step}">${escape(label)} <span aria-hidden="true">↗</span></button>`;
  const resetButton = '<button class="text-link" data-demo-reset>Choose a different sample</button>';
  function setStep(step) {
    current = stageNames.includes(step) ? step : 'scope';
    document.querySelectorAll('[data-demo-step]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.demoStep === current));
    });
  }
  function sources() { return Array.isArray(fixture?.finding?.sources) ? fixture.finding.sources : []; }
  function safeChecks(checks) {
    if (Array.isArray(checks)) return checks.map(check => check && typeof check === 'object' && check.file ? `${check.file}: ${check.status} · ${check.bytes} bytes${check.json_valid ? ' · valid JSON' : ''}${check.expected_sha256_matches ? ' · expected SHA-256 matches' : ''}` : plain(check));
    if (checks && typeof checks === 'object') return Object.entries(checks).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${plain(value)}`);
    return checks ? [plain(checks)] : [];
  }
  function render() {
    if (!stage || !fixture) return;
    stage.setAttribute('aria-busy', 'false');
    setStep(current);
    if (current === 'scope') {
      const unique = Array.from(new Map([...sources(), ...(Array.isArray(fixture.finding.exceptions) ? fixture.finding.exceptions.filter(item => item && typeof item === 'object') : [])].map(source => [source.file || source.source || source.date, source])).values()).slice(0, 4);
      stage.innerHTML = `<p class="eyebrow">01 / Choose what counts</p><h3>A little context.<br>A useful place to start.</h3><p>${escape(plain(fixture.scope_summary))}</p><div class="scope-options" role="group" aria-label="Choose a synthetic history example"><button data-sample="supported" aria-pressed="${sample === 'supported'}">Recurring task</button><button data-sample="thin" aria-pressed="${sample === 'thin'}">Thin history</button></div><div class="scope-card"><div class="receipt-top"><span>${sample === 'supported' ? 'SELECTED SYNTHETIC SOURCES' : 'THIN-HISTORY CASE'}</span><span>LOCAL FIXTURE</span></div>${sample === 'supported' ? unique.map(source => `<div class="source-row"><span><span class="source-dot" aria-hidden="true"></span>${escape(source.file || source.source || 'Synthetic source')}</span><time>${escape(source.date ? source.date.slice(0, 10) : 'Date in source')}</time></div>`).join('') + '<p>Invented sessions. Sources stay attached to the finding.</p>' : '<p>A small or inconclusive history should return uncertainty, not a confident personal rule.</p>'}</div><div class="actions">${nextButton('finding', sample === 'supported' ? 'Inspect the recorded finding' : 'Inspect the thin-history result')}</div>`;
    } else if (current === 'finding' && sample === 'thin') {
      const empty = fixture.empty;
      stage.innerHTML = `<div class="empty-state"><span aria-hidden="true">↳</span><p class="eyebrow">02 / ${empty ? 'Recorded thin-history result' : 'What an inconclusive result means'}</p><h3>Nothing strong enough<br>to call your usual.</h3><p>${escape(empty ? plain(empty.message || empty.reason || empty.summary || empty) : 'A finding needs supported human context. An assistant suggestion, an isolated “yes,” or a passing test is not an endorsed preference.')}</p><p class="micro">${empty ? 'The local tool returned no supported finding for the supplied thin-history fixture.' : 'This explains the empty state; it is not a scan of your history.'} You can choose a tool directly without importing more history.</p><div class="actions"><a class="button primary" href="#menu">Browse the menu ↗</a>${resetButton}</div></div>`;
    } else if (current === 'finding') {
      const finding = fixture.finding;
      stage.innerHTML = `<p class="eyebrow">02 / A finding, with its working</p><article class="finding-paper"><p class="eyebrow">Evidence-supported candidate</p><h3>${escape(finding.title)}</h3><p>${escape(plain(finding.interpretation))}</p><div class="finding-context"><div><strong>Scope</strong><p>${escape(plain(finding.scope))}</p></div><div><strong>Exception / uncertainty</strong><p>${escape(Array.isArray(finding.exceptions) ? finding.exceptions.map(item => item.quote || plain(item)).join(' ') : plain(finding.exceptions))}</p><p>${escape(plain(finding.uncertainty))}</p></div></div><details class="evidence-details"><summary>Inspect ${sources().length} cited sources</summary>${sources().map(source => `<div class="evidence-card"><p class="source-citation">${escape(source.date)} · ${escape(source.file || source.source)}${source.line ? `:${escape(source.line)}` : ''}</p><blockquote>“${escape(source.quote)}”</blockquote>${source.context ? `<p class="micro">${escape(plain(source.context))}</p>` : ''}</div>`).join('')}</details></article><div class="actions">${nextButton('action', 'Inspect the selected improvement')}${resetButton}</div>`;
    } else if (current === 'action') {
      const action = fixture.action;
      stage.innerHTML = `<p class="eyebrow">03 / Make the repetition useful</p><h3>${escape(action.title)}</h3><p>${escape(plain(action.description || 'Keep the stable method. Supply new inputs each time. Inspect the scope and steps before invoking the routine.'))}</p>${Array.isArray(action.steps) ? `<ol class="action-steps">${action.steps.map(step => `<li>${escape(plain(step))}</li>`).join('')}</ol>` : `<p>${escape(plain(action.steps))}</p>`}<pre id="recorded-command" tabindex="0">${escape(plain(action.command))}</pre><p class="micro">This command was run by the reproducible fixture. Buttons here show its saved output; they do not install or execute anything on your computer.</p><div class="actions">${nextButton('receipt', 'Inspect the recorded use')}<a class="text-link" href="/menu/loops/">Make a local routine ↗</a></div>`;
    } else if (current === 'receipt') {
      const receipt = fixture.receipt;
      stage.innerHTML = `<div class="demo-receipt"><div class="receipt-top"><span>USUAL / RECEIPT</span><span>SYNTHETIC RUN</span></div><p class="eyebrow">04 / Here’s what actually happened</p><h3>${escape(receipt.outcome)}</h3>${safeChecks(receipt.checks).map(check => `<div class="receipt-check"><span aria-hidden="true">✓</span><div>${escape(check)}</div></div>`).join('')}<p class="receipt-limit">${escape(plain(receipt.limitation))}</p><div class="receipt-bottom">INSPECTABLE OUTPUT · NOT A LIVE AGENT SESSION</div></div><div class="actions">${nextButton('share', 'Inspect the shareable setup')}<a class="text-link" href="/flagship.json">Full fixture receipt ↗</a></div>`;
    } else if (current === 'share') {
      stage.innerHTML = `<div class="recipe-paper"><div class="receipt-top"><span>MY USUAL / SHAREABLE RECIPE</span><span>SYNTHETIC EXAMPLE</span></div><h3>The setup travels.<br>The history stays yours.</h3><p>Review the exact recipe below. It includes the allowlisted tools and safe configuration from this example.</p><pre id="sample-recipe" tabindex="0">${escape(JSON.stringify(fixture.recipe, null, 2))}</pre><p class="micro" style="margin-top:12px;margin-bottom:0">No transcripts, source quotes, private project names, local paths, credentials, permission settings, or private preferences.</p></div><div class="actions"><button class="button primary" data-download-recipe>Download example recipe <span aria-hidden="true">↓</span></button><button class="text-link" data-copy-target="sample-recipe">Copy JSON</button><a class="text-link" href="/example-setup.html">Open the HTML card ↗</a></div><p class="micro" style="margin:12px 0 0">This is a sample recipe. Your real My Usual is saved and managed by the local commands.</p>`;
    }
  }
  function loading() {
    stage.setAttribute('aria-busy', 'true');
    stage.innerHTML = '<div class="loading-state"><span class="loading-dot" aria-hidden="true"></span><p>Loading the recorded example…</p><p class="micro">Only public synthetic data is requested.</p></div>';
  }
  async function loadDemo() {
    if (!stage) return;
    if (loadPromise) return loadPromise;
    loading();
    loadPromise = (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        let response;
        try { response = await fetch('/flagship.json', {signal: controller.signal, credentials: 'omit'}); }
        finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error('Unavailable example');
        const payload = await response.json();
        const data = payload.ui || payload.public_demo || payload;
        if (!data.finding?.title || !Array.isArray(data.finding.sources) || !data.action?.command || !data.receipt?.outcome || !data.recipe || !data.scope_summary) throw new Error('Incomplete example');
        fixture = data;
        render();
      } catch (_) {
        stage.setAttribute('aria-busy', 'false');
        stage.innerHTML = '<div class="error-state"><span aria-hidden="true">↺</span><p class="eyebrow">The example couldn’t load</p><h3>Let’s give that<br>another try.</h3><p>The recorded fixture is unavailable or incomplete. You can still browse all six tools or copy the local handoff.</p><div class="actions"><button class="button primary" data-demo-retry>Reload the example ↗</button><a class="text-link" href="#menu">Browse the menu</a></div></div>';
      } finally { loadPromise = null; }
    })();
    return loadPromise;
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.copyTarget) { await copyTarget(button); return; }
    if (button.hasAttribute('data-demo-retry')) { await loadDemo(); return; }
    if (button.hasAttribute('data-demo-reset')) { sample = 'supported'; setStep('scope'); if (fixture) render(); else await loadDemo(); return; }
    if (button.dataset.sample) { sample = button.dataset.sample; render(); return; }
    if (button.dataset.demoStep || button.dataset.demoNext) {
      setStep(button.dataset.demoStep || button.dataset.demoNext);
      if (current !== 'finding' && current !== 'scope') sample = 'supported';
      if (fixture) render(); else await loadDemo();
      return;
    }
    if (button.hasAttribute('data-show-recipe')) {
      setStep('share');
      if (fixture) render(); else await loadDemo();
      byId('example')?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      return;
    }
    if (button.hasAttribute('data-download-recipe') && fixture?.recipe) {
      const blob = new Blob([JSON.stringify(fixture.recipe, null, 2) + '\n'], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'usual-example-recipe.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce('Example recipe prepared for download. Inspect it before importing locally.');
    }
  });
  if (stage) loadDemo();
})();
