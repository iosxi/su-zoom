/**
 * ツールバーボタンのポップアップ。
 *
 * ズームの上げ下げはその場で効き (保存はしない)、
 * 「このズームで保存」を押したときだけルールとして残る。
 */
(() => {
  const el = {
    page: document.getElementById('page-label'),
    zoomSection: document.getElementById('zoom-section'),
    ruleSection: document.getElementById('rule-section'),
    unsupported: document.getElementById('unsupported'),
    input: document.getElementById('zoom-input'),
    out: document.getElementById('zoom-out'),
    in: document.getElementById('zoom-in'),
    reset: document.getElementById('zoom-reset'),
    status: document.getElementById('rule-status'),
    candidates: document.getElementById('candidates'),
    pattern: document.getElementById('pattern'),
    preview: document.getElementById('preview'),
    save: document.getElementById('save'),
    remove: document.getElementById('remove'),
    result: document.getElementById('result'),
    options: document.getElementById('open-options'),
  };

  let tab = null;
  let loc = null;
  let settings = null;
  let rules = [];
  let percent = 100;

  el.options.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
    window.close();
  });

  function showZoom() {
    el.input.value = String(percent);
  }

  async function setZoom(next) {
    percent = suzoomClampZoom(next);
    if (percent === null) percent = 100;
    showZoom();
    try {
      await browser.tabs.setZoom(tab.id, percent / 100);
    } catch (e) {
      el.result.textContent = 'ズームを変えられませんでした';
    }
    updatePreview();
  }

  /** 現在のルール一覧から、この URL に効いているものを探して表示する。 */
  function showStatus() {
    const applied = suzoomFindRule(rules, loc, settings.includeSubdomains !== false);
    if (applied) {
      el.status.className = 'status';
      el.status.textContent =
        '適用中のルール: ' + applied.pattern + ' → ' + applied.zoom + '%';
    } else if (settings.unmatched === 'browser') {
      el.status.className = 'status none';
      el.status.textContent = '一致するルールはありません (Firefox の設定のまま)';
    } else {
      el.status.className = 'status none';
      el.status.textContent =
        '一致するルールはありません (このページを開くと既定の ' + settings.defaultZoom + '% になります)';
    }
    return applied;
  }

  /** ルール欄の内容から、保存すると何が起きるかを出す。 */
  function updatePreview() {
    const pattern = suzoomNormalizePattern(el.pattern.value);
    if (!pattern) {
      el.preview.className = 'preview warn';
      el.preview.textContent = 'ドメインから書いてください (例: example.com/news)';
      el.save.disabled = true;
      el.remove.disabled = true;
      return;
    }

    const existing = rules.find((r) => r.pattern === pattern);
    const hits = suzoomMatch(pattern, loc, settings.includeSubdomains !== false);

    el.save.disabled = false;
    el.remove.disabled = !existing;
    el.save.textContent = existing ? 'このズームで更新' : 'このズームで保存';

    if (!hits) {
      el.preview.className = 'preview warn';
      el.preview.textContent = 'このルールは今開いているページには当たりません';
      return;
    }
    el.preview.className = 'preview';
    el.preview.textContent =
      pattern + ' で始まるページを ' + percent + '% にします' + (existing ? ' (既存のルールを上書き)' : '');
  }

  el.pattern.addEventListener('input', () => {
    el.result.textContent = '';
    updatePreview();
  });

  el.candidates.addEventListener('change', () => {
    el.pattern.value = el.candidates.value;
    el.result.textContent = '';
    updatePreview();
  });

  el.out.addEventListener('click', () => setZoom(suzoomStep(percent, -1)));
  el.in.addEventListener('click', () => setZoom(suzoomStep(percent, 1)));
  el.reset.addEventListener('click', () => setZoom(100));
  el.input.addEventListener('change', () => setZoom(el.input.value));

  el.save.addEventListener('click', async () => {
    const pattern = suzoomNormalizePattern(el.pattern.value);
    if (!pattern) return;
    const next = rules.filter((r) => r.pattern !== pattern);
    next.push({ pattern, zoom: percent, enabled: true });
    await browser.storage.local.set({ rules: next });
    rules = next;
    el.pattern.value = pattern;
    el.result.textContent = '保存しました';
    showStatus();
    updatePreview();
  });

  el.remove.addEventListener('click', async () => {
    const pattern = suzoomNormalizePattern(el.pattern.value);
    const next = rules.filter((r) => r.pattern !== pattern);
    if (next.length === rules.length) return;
    await browser.storage.local.set({ rules: next });
    rules = next;
    el.result.textContent = '削除しました';
    showStatus();
    updatePreview();
  });

  (async () => {
    const loaded = await suzoomLoad();
    settings = loaded.settings;
    rules = loaded.rules;

    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
    loc = tab ? suzoomParseUrl(tab.url) : null;

    if (!loc) {
      el.page.textContent = tab && tab.url ? tab.url : '(ページがありません)';
      el.zoomSection.hidden = true;
      el.ruleSection.hidden = true;
      el.unsupported.hidden = false;
      return;
    }

    el.page.textContent = loc.host + loc.path;

    try {
      percent = Math.round((await browser.tabs.getZoom(tab.id)) * 100);
    } catch (e) {
      percent = 100;
    }
    showZoom();

    const applied = showStatus();

    // 候補は細かい順。すでにルールがあればそれを選び、無ければページそのものを選ぶ。
    const candidates = suzoomCandidates(loc);
    if (applied && candidates.indexOf(applied.pattern) === -1) candidates.unshift(applied.pattern);
    for (const value of candidates) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      el.candidates.appendChild(option);
    }
    const initial = applied ? applied.pattern : candidates[0];
    el.candidates.value = initial;
    el.pattern.value = initial;

    updatePreview();
  })();
})();
