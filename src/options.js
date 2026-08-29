/**
 * su-zoom の設定画面。
 * 触ったその場で保存する。保存ボタンは置かない。
 */
(() => {
  const el = {
    rules: document.getElementById('rules'),
    empty: document.getElementById('empty'),
    add: document.getElementById('add'),
    rulesResult: document.getElementById('rules-result'),
    defaultZoom: document.getElementById('default-zoom'),
    includeSubdomains: document.getElementById('include-subdomains'),
    badge: document.getElementById('badge'),
    io: document.getElementById('io'),
    exportButton: document.getElementById('export'),
    importButton: document.getElementById('import'),
    ioResult: document.getElementById('io-result'),
  };
  const unmatched = Array.from(document.querySelectorAll('input[name="unmatched"]'));

  let noticeTimer = null;
  function notice(node, text) {
    node.textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      node.textContent = '';
    }, 2400);
  }

  /* ---- ルール一覧 ------------------------------------------------------ */

  /** DOM の行からルールの配列を作る。空欄と書き間違いは落とす。 */
  function collect() {
    const rules = [];
    const seen = new Map();
    let dropped = 0;

    for (const row of el.rules.querySelectorAll('tr')) {
      const patternInput = row.querySelector('.pattern');
      const zoomInput = row.querySelector('.zoom');
      const enabled = row.querySelector('.enabled').checked;

      const pattern = suzoomNormalizePattern(patternInput.value);
      const zoom = suzoomClampZoom(zoomInput.value);
      const blank = patternInput.value.trim() === '';

      patternInput.classList.toggle('invalid', !pattern && !blank);
      if (!pattern || zoom === null) {
        if (!blank) dropped += 1;
        continue;
      }

      const rule = { pattern, zoom, enabled };
      if (seen.has(pattern)) {
        // 同じルールを 2 つ持っても意味が無いので、後の行で上書きする
        rules[seen.get(pattern)] = rule;
        dropped += 1;
      } else {
        seen.set(pattern, rules.length);
        rules.push(rule);
      }
    }
    return { rules, dropped };
  }

  async function save() {
    const { rules, dropped } = collect();
    await browser.storage.local.set({ rules });
    notice(el.rulesResult, dropped > 0 ? '保存しました (重複と書き間違いを除く)' : '保存しました');
  }

  function updateEmpty() {
    el.empty.hidden = el.rules.querySelector('tr') !== null;
  }

  function addRow(rule, focus) {
    const row = document.createElement('tr');

    const onCell = document.createElement('td');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.className = 'enabled';
    enabled.checked = rule.enabled !== false;
    enabled.title = 'このルールを使う';
    onCell.appendChild(enabled);

    const patternCell = document.createElement('td');
    const pattern = document.createElement('input');
    pattern.type = 'text';
    pattern.className = 'pattern';
    pattern.spellcheck = false;
    pattern.autocomplete = 'off';
    pattern.placeholder = 'example.com/cat/news/japan';
    pattern.value = rule.pattern || '';
    patternCell.appendChild(pattern);

    const zoomCell = document.createElement('td');
    const zoomWrap = document.createElement('span');
    zoomWrap.className = 'zoom-cell';
    const zoom = document.createElement('input');
    zoom.type = 'number';
    zoom.className = 'zoom';
    zoom.min = String(SUZOOM_MIN);
    zoom.max = String(SUZOOM_MAX);
    zoom.step = '1';
    zoom.value = String(rule.zoom || 100);
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = '%';
    zoomWrap.append(zoom, unit);
    zoomCell.appendChild(zoomWrap);

    const delCell = document.createElement('td');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = '×';
    del.title = 'このルールを削除';
    del.addEventListener('click', async () => {
      row.remove();
      updateEmpty();
      await save();
    });
    delCell.appendChild(del);

    row.append(onCell, patternCell, zoomCell, delCell);
    el.rules.appendChild(row);

    // 入力欄は確定 (change) で保存する。1 文字ごとに書くと正規化が邪魔になる。
    pattern.addEventListener('change', async () => {
      const normalized = suzoomNormalizePattern(pattern.value);
      if (normalized) pattern.value = normalized;
      await save();
    });
    zoom.addEventListener('change', async () => {
      const clamped = suzoomClampZoom(zoom.value);
      if (clamped !== null) zoom.value = String(clamped);
      await save();
    });
    enabled.addEventListener('change', save);

    if (focus) pattern.focus();
    updateEmpty();
  }

  el.add.addEventListener('click', () => addRow({ pattern: '', zoom: 100, enabled: true }, true));

  /* ---- 設定 ------------------------------------------------------------ */

  async function saveSettings() {
    const chosen = unmatched.find((radio) => radio.checked);
    const settings = {
      unmatched: chosen ? chosen.value : 'default',
      defaultZoom: suzoomClampZoom(el.defaultZoom.value) || 100,
      includeSubdomains: el.includeSubdomains.checked,
      badge: el.badge.value,
    };
    el.defaultZoom.value = String(settings.defaultZoom);
    el.defaultZoom.disabled = settings.unmatched !== 'default';
    await browser.storage.local.set({ settings });
  }

  for (const radio of unmatched) radio.addEventListener('change', saveSettings);
  el.defaultZoom.addEventListener('change', saveSettings);
  el.includeSubdomains.addEventListener('change', saveSettings);
  el.badge.addEventListener('change', saveSettings);

  /* ---- 持ち出しと取り込み ---------------------------------------------- */

  el.exportButton.addEventListener('click', async () => {
    const { rules } = await suzoomLoad();
    el.io.value = JSON.stringify(rules, null, 2);
    notice(el.ioResult, rules.length + ' 件を書き出しました');
  });

  el.importButton.addEventListener('click', async () => {
    let incoming = null;
    try {
      incoming = JSON.parse(el.io.value);
    } catch (e) {
      notice(el.ioResult, 'JSON として読めませんでした');
      return;
    }
    if (!Array.isArray(incoming)) {
      notice(el.ioResult, 'ルールの配列を貼り付けてください');
      return;
    }

    const { rules } = await suzoomLoad();
    const merged = rules.slice();
    const index = new Map(merged.map((rule, i) => [rule.pattern, i]));
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of incoming) {
      const pattern = suzoomNormalizePattern(item && item.pattern);
      const zoom = suzoomClampZoom(item && item.zoom);
      if (!pattern || zoom === null) {
        skipped += 1;
        continue;
      }
      const rule = { pattern, zoom, enabled: !(item && item.enabled === false) };
      if (index.has(pattern)) {
        merged[index.get(pattern)] = rule;
        updated += 1;
      } else {
        index.set(pattern, merged.length);
        merged.push(rule);
        added += 1;
      }
    }

    await browser.storage.local.set({ rules: merged });
    el.rules.textContent = '';
    for (const rule of merged) addRow(rule, false);
    updateEmpty();
    notice(
      el.ioResult,
      '追加 ' + added + ' 件 / 更新 ' + updated + ' 件' + (skipped > 0 ? ' / 読めず ' + skipped + ' 件' : '')
    );
  });

  /* ---- 起動 ------------------------------------------------------------ */

  (async () => {
    const { settings, rules } = await suzoomLoad();

    for (const rule of rules) addRow(rule, false);
    updateEmpty();

    for (const radio of unmatched) radio.checked = radio.value === settings.unmatched;
    el.defaultZoom.value = String(settings.defaultZoom);
    el.defaultZoom.disabled = settings.unmatched !== 'default';
    el.includeSubdomains.checked = settings.includeSubdomains !== false;
    el.badge.value = settings.badge || 'nondefault';
  })();
})();
