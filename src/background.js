/**
 * su-zoom の背景ページ。
 *
 * やることは 2 つだけ。
 *   1. タブの URL が変わったら、当てはまるルールのズームを当てる
 *   2. ツールバーのアイコンに今のズームを出す
 *
 * MV2 の背景ページは background.scripts の全ファイルを同じスコープで読むため、
 * 全体を IIFE で閉じる (common.js だけは両方の文脈で使うので閉じていない)。
 */
(() => {
  let settings = Object.assign({}, SUZOOM_DEFAULTS);
  let rules = [];

  /** ズームの端数。Firefox が返す倍率は 1.3300000000000001 のようになる。 */
  const EPSILON = 0.005;

  /**
   * 設定を読み終えるまで待つための約束。
   *
   * 起動直後はタブの復元と背景ページの初期化が同時に走る。読み終える前に
   * onUpdated が来ると、ルールがまだ空のまま既定値を当ててしまい、
   * オリジンごとの保存値を壊す。当てる処理はこれを必ず待つ。
   */
  let ready = null;

  function reload() {
    ready = (async () => {
      const loaded = await suzoomLoad();
      settings = loaded.settings;
      rules = loaded.rules;
    })();
    return ready;
  }
  reload();

  /** この URL に当てるべきズーム (パーセント)。当てないときは null。 */
  function zoomFor(url) {
    const loc = suzoomParseUrl(url);
    if (!loc) return null;
    const rule = suzoomFindRule(rules, loc, settings.includeSubdomains !== false);
    if (rule) return suzoomClampZoom(rule.zoom);
    if (settings.unmatched === 'browser') return null;
    return suzoomClampZoom(settings.defaultZoom);
  }

  /**
   * タブにズームを当てる。
   *
   * Firefox のズームはオリジン単位で保存されるので、同じサイトの中で
   * ルールの内と外を行き来しても正しくなるよう、毎回そのつど当て直す。
   */
  async function applyToTab(tabId, url) {
    await ready;
    const target = zoomFor(url);
    if (target === null) {
      await updateBadge(tabId);
      return;
    }
    const factor = target / 100;
    try {
      const current = await browser.tabs.getZoom(tabId);
      if (Math.abs(current - factor) > EPSILON) await browser.tabs.setZoom(tabId, factor);
    } catch (e) {
      // タブが閉じた、まだ読み込めていない、about: へ移った等。次の機会に当たる。
      return;
    }
    await updateBadge(tabId, target);
  }

  /** アイコンの数字と説明を今のズームに合わせる。 */
  async function updateBadge(tabId, knownPercent) {
    let percent = knownPercent;
    if (percent === undefined) {
      try {
        percent = Math.round((await browser.tabs.getZoom(tabId)) * 100);
      } catch (e) {
        percent = null;
      }
    }

    const mode = settings.badge || 'nondefault';
    const show = percent !== null && (mode === 'always' || (mode === 'nondefault' && percent !== 100));

    try {
      await browser.browserAction.setBadgeText({ tabId, text: show ? String(percent) : '' });
      await browser.browserAction.setTitle({
        tabId,
        title: percent === null ? 'su-zoom' : 'su-zoom — ' + percent + '%',
      });
    } catch (e) {
      // タブが無くなっていた場合。何もしない。
    }
  }

  /** 開いている全タブに当て直す。設定を変えたときに使う。 */
  async function applyToAll() {
    let tabs = [];
    try {
      tabs = await browser.tabs.query({});
    } catch (e) {
      return;
    }
    for (const tab of tabs) {
      if (tab.id !== undefined) await applyToTab(tab.id, tab.url);
    }
  }

  browser.tabs.onUpdated.addListener(
    (tabId, changeInfo, tab) => {
      // status は about:blank から目的の URL へ移る途中でも来る。URL を見て判断する。
      if (!changeInfo.url && changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return;
      applyToTab(tabId, changeInfo.url || tab.url);
    },
    { properties: ['status', 'url'] }
  );

  // タブを切り替えたときは当て直さず、数字だけ合わせる。
  browser.tabs.onActivated.addListener(({ tabId }) => {
    updateBadge(tabId);
  });

  // 利用者が Ctrl+= などで変えたときも数字を合わせる。ルールでは上書きしない。
  browser.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
    updateBadge(tabId, Math.round(newZoomFactor * 100));
  });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (!changes.settings && !changes.rules) return;
    await reload();
    await applyToAll();
  });

  browser.runtime.onStartup.addListener(async () => {
    await reload();
    await applyToAll();
  });

  browser.runtime.onInstalled.addListener(async () => {
    await reload();
    await applyToAll();
  });

  (async () => {
    await ready;
    try {
      await browser.browserAction.setBadgeBackgroundColor({ color: '#2563eb' });
      await browser.browserAction.setBadgeTextColor({ color: '#ffffff' });
    } catch (e) {
      // setBadgeTextColor は古い Firefox に無い。既定の色で困らない。
    }
    await applyToAll();
  })();
})();
