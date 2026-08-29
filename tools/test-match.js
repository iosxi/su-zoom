/**
 * ルール照合の確認 (依存なし)。
 *   node tools/test-match.js
 *
 * src/common.js をそのまま読み込んで、README に書いた例が本当に
 * そのとおりになるかを確かめる。照合はこの拡張機能の核なので、
 * 手で試すより先にここで落とす。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'common.js'), 'utf8');
const sandbox = { URL, Number, Math, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'common.js' });

const {
  suzoomParseUrl,
  suzoomNormalizePattern,
  suzoomMatch,
  suzoomFindRule,
  suzoomCandidates,
  suzoomStep,
  suzoomClampZoom,
} = sandbox;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         期待 ' + JSON.stringify(expected) + ' / 実際 ' + JSON.stringify(actual)));
}

/** ルール 1 件が URL に当たるか (サブドメイン込み)。 */
function hits(pattern, url) {
  const loc = suzoomParseUrl(url);
  if (!loc) return false;
  return suzoomMatch(suzoomNormalizePattern(pattern), loc, true) !== null;
}

console.log('README の例 (ルール example.com/cat/news/japan)');
const rule = 'example.com/cat/news/japan';
check('https で完全一致', hits(rule, 'https://example.com/cat/news/japan'), true);
check('下の階層', hits(rule, 'http://example.com/cat/news/japan/1001'), true);
check('続きの文字 (japanese)', hits(rule, 'http://example.com/cat/news/japanese'), true);
check('クエリ付き', hits(rule, 'http://example.com/cat/news/japan?page=1'), true);
check('別のパス (usa)', hits(rule, 'https://example.com/cat/news/usa'), false);
check('クエリに japan があるだけ', hits(rule, 'http://example.com/cat/news/china?cat=japan'), false);

console.log('');
console.log('クエリもルールに書ける');
check('クエリだけのルール', hits('example.com?cat=japan', 'https://example.com/?cat=japan'), true);
check('/ 付きで書いても同じ', hits('example.com/?cat=japan', 'https://example.com?cat=japan'), true);
check('後ろに続いてもよい', hits('example.com?cat=japan', 'https://example.com/?cat=japan&page=2'), true);
check('別のクエリには当たらない', hits('example.com?cat=japan', 'https://example.com/?cat=usa'), false);
check('クエリ無しのページには当たらない', hits('example.com?cat=japan', 'https://example.com/'), false);
check('パスとクエリの両方', hits('example.com/news?cat=japan', 'https://example.com/news?cat=japan&p=2'), true);
check('パスだけのルールはクエリ付きにも当たる', hits('example.com/news', 'https://example.com/news?cat=usa'), true);
check('# より後ろは見ない', hits('example.com/news', 'https://example.com/news#top'), true);

console.log('');
console.log('ホストの扱い');
check('サブドメインに効く', hits('example.com', 'https://www.example.com/'), true);
check('似た別ドメインには効かない', hits('example.com', 'https://example.com.evil.test/'), false);
check('前方一致で他ドメインを拾わない', hits('example.com', 'https://example.community/'), false);
check('大文字は同じ扱い', hits('EXAMPLE.com/News', 'https://example.com/News'), true);
check('about: は対象外', hits('example.com', 'about:config'), false);

console.log('');
console.log('末尾のスラッシュ');
check('/cat は /category にも当たる', hits('example.com/cat', 'https://example.com/category'), true);
check('/cat/ は /category に当たらない', hits('example.com/cat/', 'https://example.com/category'), false);
check('/cat/ は /cat/news に当たる', hits('example.com/cat/', 'https://example.com/cat/news'), true);

console.log('');
console.log('正規化');
check('スキームを落とす', suzoomNormalizePattern('https://example.com/a'), 'example.com/a');
check('# 以降は落とす', suzoomNormalizePattern('example.com/a?b=1#c'), 'example.com/a?b=1');
check('クエリは残す', suzoomNormalizePattern('https://example.com?b=1'), 'example.com/?b=1');
check('前後の空白を落とす', suzoomNormalizePattern('  example.com/a  '), 'example.com/a');
check('空文字は空文字', suzoomNormalizePattern('   '), '');
check('パスだけは無効', suzoomNormalizePattern('/a/b'), 'a/b');

console.log('');
console.log('いちばん細かいルールが勝つ');
const rules = [
  { pattern: 'example.com', zoom: 110, enabled: true },
  { pattern: 'example.com/cat', zoom: 120, enabled: true },
  { pattern: 'example.com/cat/news/japan', zoom: 150, enabled: true },
  { pattern: 'news.example.com', zoom: 90, enabled: true },
  { pattern: 'example.com/off', zoom: 500, enabled: false },
];
const pick = (url) => {
  const found = suzoomFindRule(rules, suzoomParseUrl(url), true);
  return found ? found.zoom : null;
};
check('もっとも長いパス', pick('https://example.com/cat/news/japan/1001'), 150);
check('途中のパス', pick('https://example.com/cat/other'), 120);
check('ドメインだけ', pick('https://example.com/'), 110);
check('サブドメインの完全一致が優先', pick('https://news.example.com/cat/news/japan'), 90);
check('切ってあるルールは使わない', pick('https://example.com/off'), 110);

console.log('');
console.log('候補とズームの刻み');
check(
  '候補は細かい順',
  suzoomCandidates(suzoomParseUrl('https://example.com/cat/news/japan')),
  ['example.com/cat/news/japan', 'example.com/cat/news', 'example.com/cat', 'example.com']
);
check(
  'クエリ込みの候補が先頭に付く',
  suzoomCandidates(suzoomParseUrl('https://example.com/news?cat=japan')),
  ['example.com/news?cat=japan', 'example.com/news', 'example.com']
);
check('1 段上', suzoomStep(100, 1), 110);
check('1 段下', suzoomStep(100, -1), 90);
check('上限で止まる', suzoomStep(500, 1), 500);
check('下限で止まる', suzoomStep(30, -1), 30);
check('範囲外は丸める', suzoomClampZoom(9999), 500);
check('数でなければ null', suzoomClampZoom('あ'), null);

console.log('');
if (failures > 0) {
  console.log(failures + ' 件が期待どおりではありません。');
  process.exit(1);
}
console.log('すべて期待どおりです。');
