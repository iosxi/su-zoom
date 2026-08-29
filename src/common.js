/**
 * su-zoom の共有部分。設定の既定値と、ルールの正規化・照合。
 *
 * 背景ページ (background.js) と画面 (popup.js / options.js) の両方から読むため、
 * IIFE で包まずにグローバルへ置いている。名前は SUZOOM_ / suzoom で始めて
 * 他のスクリプトと衝突しないようにする。
 */

/** Firefox が受け付けるズームの範囲 (パーセント)。 */
var SUZOOM_MIN = 30;
var SUZOOM_MAX = 500;

/** Firefox 本体の Ctrl+= / Ctrl+- と同じ刻み。 */
var SUZOOM_STEPS = [30, 50, 67, 80, 90, 100, 110, 120, 133, 150, 170, 200, 240, 300, 400, 500];

var SUZOOM_DEFAULTS = {
  /** ルールに一致しないページの扱い。'default' = 既定のズームにする / 'browser' = Firefox にまかせる */
  unmatched: 'default',
  /** 上が 'default' のときに使うズーム (パーセント)。 */
  defaultZoom: 100,
  /** ルールのホストをサブドメインにも適用する (example.com のルールが www.example.com にも効く)。 */
  includeSubdomains: true,
  /** ツールバーの数字表示。'nondefault' = 100% 以外のとき / 'always' / 'never' */
  badge: 'nondefault',
};

/** ズームを設定できる URL か。about: や moz-extension: には効かない。 */
function suzoomIsZoomable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/**
 * URL を照合用の形に開く。
 *
 * path には**クエリ (?…) も含める**。example.com?cat=japan のように、
 * どのページかがクエリで決まるサイトがあるため。
 * フラグメント (#…) だけは同じページの中の位置なので落とす。
 */
function suzoomParseUrl(url) {
  if (!suzoomIsZoomable(url)) return null;
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), path: (u.pathname || '/') + u.search };
  } catch (e) {
    return null;
  }
}

/**
 * 利用者が書いたルール文字列を正規化する。
 *
 *   https://example.com/cat/news/japan  ->  example.com/cat/news/japan
 *   EXAMPLE.COM                         ->  example.com
 *   example.com?cat=japan               ->  example.com/?cat=japan
 *   example.com/news#top                ->  example.com/news
 *
 * クエリは落とさない。URL の pathname は必ず「/」で始まるので、
 * ホストの直後がクエリのときだけ「/」を補って形を揃える。
 *
 * 末尾の「/」も落とさない。付けるかどうかで意味が変わる:
 *   example.com/cat   -> /cat, /cat/news, /category すべてに一致 (前方一致)
 *   example.com/cat/  -> /cat/news には一致するが /category には一致しない
 */
function suzoomNormalizePattern(input) {
  let text = String(input == null ? '' : input).trim();
  if (!text) return '';
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // スキーム
  text = text.replace(/^\/+/, '');
  text = text.split('#')[0];
  if (!text) return '';

  const cut = text.search(/[/?]/);
  const host = (cut === -1 ? text : text.slice(0, cut)).toLowerCase();
  let rest = cut === -1 ? '' : text.slice(cut);
  if (!host || host.indexOf(' ') !== -1) return '';
  if (rest.charAt(0) === '?') rest = '/' + rest;
  return host + rest;
}

/** 正規化済みのルール文字列をホストとパスに分ける。 */
function suzoomSplitPattern(pattern) {
  const text = String(pattern || '');
  const slash = text.indexOf('/');
  if (slash === -1) return { host: text, path: '' };
  return { host: text.slice(0, slash), path: text.slice(slash) };
}

/**
 * ルール 1 件がこの URL に当てはまるか調べる。
 *
 * ホストは完全一致 (設定によりサブドメインも可)、パスは単純な前方一致。
 * ホストを前方一致にしないのは、example.com のルールが
 * example.com.example.net に当たってしまうのを避けるため。
 *
 * 当たったときは並べ替え用の重みを返す。当たらなければ null。
 */
function suzoomMatch(pattern, loc, includeSubdomains) {
  const rule = suzoomSplitPattern(pattern);
  if (!rule.host) return null;

  let exact = false;
  if (loc.host === rule.host) {
    exact = true;
  } else if (includeSubdomains && loc.host.endsWith('.' + rule.host)) {
    exact = false;
  } else {
    return null;
  }

  if (rule.path && !loc.path.startsWith(rule.path)) return null;
  return { exact, hostLength: rule.host.length, pathLength: rule.path.length };
}

/**
 * 一致するルールのうち、いちばん細かいものを返す。
 * 強い順に「ホスト完全一致 > ホストが長い > パスが長い」。
 * 例: mail.example.com のルールは example.com のルールより優先される。
 */
function suzoomFindRule(rules, loc, includeSubdomains) {
  let best = null;
  let bestScore = null;

  for (const rule of rules || []) {
    if (!rule || rule.enabled === false) continue;
    const score = suzoomMatch(rule.pattern, loc, includeSubdomains);
    if (!score) continue;
    if (!bestScore || suzoomCompareScore(score, bestScore) > 0) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

/** 重みの比較。正なら a のほうが細かい。 */
function suzoomCompareScore(a, b) {
  if (a.exact !== b.exact) return a.exact ? 1 : -1;
  if (a.hostLength !== b.hostLength) return a.hostLength - b.hostLength;
  return a.pathLength - b.pathLength;
}

/** ズーム値を範囲内の整数に丸める。数として読めなければ null。 */
function suzoomClampZoom(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(SUZOOM_MAX, Math.max(SUZOOM_MIN, n));
}

/** 現在値から 1 段上/下のズームを返す (direction: +1 / -1)。 */
function suzoomStep(percent, direction) {
  const current = suzoomClampZoom(percent);
  if (current === null) return 100;
  if (direction > 0) {
    for (const step of SUZOOM_STEPS) if (step > current) return step;
    return SUZOOM_MAX;
  }
  for (let i = SUZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    if (SUZOOM_STEPS[i] < current) return SUZOOM_STEPS[i];
  }
  return SUZOOM_MIN;
}

/**
 * URL から「ルールの候補」を細かい順に作る。
 * example.com/cat/news/japan/1001 なら
 *   example.com/cat/news/japan/1001, …/japan, …/news, …/cat, example.com
 *
 * クエリが付いていれば、それ込みのものを先頭に置く。
 */
function suzoomCandidates(loc) {
  if (!loc) return [];
  const list = [];
  const query = loc.path.indexOf('?');
  const pathname = query === -1 ? loc.path : loc.path.slice(0, query);
  if (query !== -1) list.push(loc.host + loc.path);

  const segments = pathname.split('/').filter((s) => s.length > 0);
  for (let i = segments.length; i > 0; i -= 1) {
    list.push(loc.host + '/' + segments.slice(0, i).join('/'));
  }
  list.push(loc.host);
  return list;
}

/** 保存されている設定を既定値で埋めて返す。 */
async function suzoomLoad() {
  let stored = {};
  try {
    stored = await browser.storage.local.get(['settings', 'rules']);
  } catch (e) {
    stored = {};
  }
  const settings = Object.assign({}, SUZOOM_DEFAULTS, stored.settings || {});
  const rules = Array.isArray(stored.rules) ? stored.rules : [];
  return { settings, rules };
}
