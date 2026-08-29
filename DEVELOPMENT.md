# DEVELOPMENT

su-zoom の開発メモ。利用者向けの説明は [README.md](README.md)。

作りかたの方針は兄弟ディレクトリの follient に合わせてある (MV2、依存なしの
自前ツール、日本語のコメント、設定はその場で保存)。`tools/build-xpi.js`、
`tools/sign.js`、`tools/fetch-signed.js` は follient から持ってきたもの。

## バージョンとリリースの方針

**XPI を変更したら、必ずバージョンを上げる。** 修正依頼で XPI の作り直しが
必要になった場合は XPI を作成し、その XPI が前回と 1 バイトでも違うなら
バージョンを上げてから配る。同じ番号で中身の違う XPI を出さない。

**番号の付けかた: `manifest.json` の `N.0.0` ↔ git タグ `vN`。**

AMO で署名した番号は**永久に消費される**。同じ番号での再アップロードは
できないので、署名前にバージョンを確定させること。

## 構成

| ファイル | 役割 |
| --- | --- |
| `manifest.json` | MV2。`browser_action` にポップアップ、`options_ui` に設定画面 |
| `src/common.js` | 既定値とルールの正規化・照合。**背景と画面の両方から読む** |
| `src/background.js` | タブの URL を見てズームを当て、アイコンの数字を更新する |
| `src/popup.html/css/js` | ツールバーのポップアップ |
| `src/options.html/css/js` | 設定画面 |
| `tools/make-icons.js` | アイコン PNG の生成 (`src/icons/*.png` は生成物) |
| `tools/test-match.js` | ルール照合の確認 |
| `tools/build-xpi.js` | 配布用 XPI の作成 (無署名) |
| `tools/sign.js` | AMO 署名 |
| `tools/fetch-signed.js` | 署名済み XPI の取得のみやり直す |
| `tools/sign.ps1` | 鍵を読み込んで sign.js を叩く。失敗したら fetch-signed.js へ回る |
| `tools/fetch-signed.ps1` | 取得だけやり直す (`-List` / `-Version`) |

## ルールの照合

この拡張機能の核。`src/common.js` にまとまっている。

照合するのは **ホスト + パス + クエリ**。落とすのはスキーム
(`http`/`https`) と `#` 以降だけ。フラグメントは同じページの中の位置を
指すものなので見ない。クエリは `example.com?cat=japan` のように、
どのページかがクエリで決まるサイトがあるので**見る**。

```
ルール   example.com/cat/news/japan
       -> host = "example.com", path = "/cat/news/japan"

URL     http://example.com/cat/news/japan/1001?x=1#top
       -> host = "example.com", path = "/cat/news/japan/1001?x=1"
```

`URL` の `pathname` は必ず `/` で始まるので、ホストの直後がクエリのルール
(`example.com?cat=japan`) は正規化で `/` を補って `example.com/?cat=japan` に
揃える。揃えないと `example.com/?cat=japan` と前方一致しない。

**ホストは完全一致、パスは前方一致。** ここを分けているのが要点で、
全体を 1 本の文字列として前方一致させると `example.com` のルールが
`example.com.example.net` や `example.community` に当たってしまう。

パスが前方一致なので `example.com/cat/news/japan` は
`example.com/cat/news/japanese` にも当たる。これは仕様
(要件にそう書かれている)。区切りで止めたい人は末尾に `/` を付ける。
そのため**正規化で末尾の `/` を落としてはいけない**。付けるかどうかで
意味が変わる唯一の文字になっている。

クエリを見る以上、順序も前方一致で効いてくる。`example.com/?a=1&b=2` は
`?b=2&a=1` には当たらない。並べ替えて正規化する手もあるが、
「書いたとおりに前方一致」という 1 本の説明で通したいので採らない。

複数当たったときは `suzoomFindRule` が「ホスト完全一致 > ホストが長い >
パスが長い」で選ぶ。サブドメインの一致は完全一致に必ず負けるので、
`example.com` を全体に効かせつつ `mail.example.com` だけ別にできる。

要件に書かれた 6 つの例はそのまま `tools/test-match.js` にしてある。
照合をいじったら必ず走らせること。

```sh
node tools/test-match.js
```

## 落とし穴

### Firefox のズームはオリジン単位で永続保存される

これが設計上いちばん重い制約。

`tabs.setZoomSettings` で `scope: 'per-tab'` は Firefox では受け付けられない
(`Unsupported zoom settings`)。使えるのは `per-origin` だけで、しかも設定した
倍率は **Firefox 自身のサイトごとのズーム設定として永続保存される**。

つまり「`example.com/news` だけ 150%」は、ブラウザの機能としては表現できない。
`example.com` というオリジンに対する 1 個の値しか持てないため。

そこで su-zoom は **ページを開くたびに毎回そのつど当て直す**。
`tabs.onUpdated` で URL を見て、当たるルールがあればその値を、無ければ
既定の値を `tabs.setZoom` する。結果として:

- パスごとに違う倍率を出せる (目的は達成)
- 利用者が Firefox に覚えさせていたサイトごとの倍率は上書きされる
- 「Firefox の設定にまかせる」を選んだ場合、ルールを消しても以前の倍率が
  そのサイトに残る (Firefox 側に書かれてしまっているため)

最後の 2 つは避けようがない。README に書いてある。

なお `mode: 'manual'` にすると拡張機能側でズームを実装することになり、
CSS の変形で誤魔化す羽目になる。採らない。

### 当てるのは `loading` と `complete` の両方

`tabs.onUpdated` は `loading` → `complete` の順に来る。`loading` の時点で
当てると切り替わりが目立たない。`complete` でもう一度当てるのは、
読み込み中にオリジンの保存値へ戻される場合の保険。

`changeInfo.url` だけを見ると、SPA 内の URL 変更は拾えても通常の遷移で
取りこぼす。`changeInfo.url || tab.url` を使うこと。

### 利用者の手動ズームを上書きしない

`tabs.onZoomChange` では**アイコンの数字だけ**を更新し、ルールを当て直さない。
当て直すと Ctrl + ホイールが効かなくなる。次にページを移動したときに
ルールの値へ戻る、という動きにしてある。

### 背景スクリプトは IIFE で閉じる

MV2 の背景ページは `background.scripts` の全ファイルを**同一のグローバル
スコープ**で読み込む。同じ名前を `const`/`let` で宣言すると、後から読まれた
ファイルが重複宣言の SyntaxError で**丸ごと実行されない**。

`src/common.js` だけは背景と画面の両方でグローバルとして使うため閉じていない。
名前はすべて `SUZOOM_` / `suzoom` で始めてある。

### `browser.tabs.setZoom` は普通に投げる

タブが閉じた、まだ読み込めていない、`about:` へ移った、といった理由で例外に
なる。全部 `try`/`catch` で握りつぶし、次の機会に当て直す。

### 16px のアイコンは別の絵にする

`tools/make-icons.js` は 16 / 32 / 48 / 96 を書き出す。16px だけは白い内枠を
描かない (線が 1px を割って潰れるため) 代わりに単眼鏡を 1.14 倍にしている。
16px と 32px は 1x / 2x の関係なので同一の利用者が両方を見ることはない。

アイコンは「地の色 + 枠」を必ず持たせること。参考にした Fixed Zoom は
背景を持たない黒いグリフで、ツールバーの配色によっては沈んで見えなくなる。
これを避けるのが今回の要件のひとつ。

### `web-ext lint` の Android 警告は残る

`strict_min_version: 140.0` と `data_collection_permissions` の組み合わせで
`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` が 1 件出る。エラーは 0 件。
Android の Firefox は `tabs.setZoom` を持たないので、`gecko_android` を足して
Android 対応を宣言するつもりはない。

## 権限

`storage` と `tabs` の 2 つだけ。Fixed Zoom と同じ構成。

要るのは **タブの URL を読む**ことだけ。`tabs.onUpdated` の `changeInfo.url` や
`tabs.query` の `tab.url` は `tabs` 権限かホスト権限のどちらかで得られる。
`tabs.setZoom` / `getZoom` はどちらの権限も要らない。
コンテンツスクリプトは注入していないし、ページの中身も読んでいない。

**`<all_urls>` は使わない。** 2.0.0 までは「ホスト権限なら表示が 1 つで済む」
と考えて `<all_urls>` にしていたが、これは判断を誤っていた。Firefox の
インストール画面での表示が違う:

| 権限 | 表示 |
| --- | --- |
| `<all_urls>` | すべてのウェブサイトのユーザーデータへのアクセス |
| `tabs` | ブラウザーのタブへのアクセス |

数は同じ 1 つでも、前者は「ページの中身を読み書きできる」と読まれる最も重い
文言で、実際にできること (URL を読むだけ) より広い。3.0.0 で `tabs` に変えた。

MV2 を使っているのは follient と同じ理由 (MV3 ではホスト権限が既定で
付与されず、利用者の許可操作を挟むことになる)。

## 作業手順

### 開発時の読み込み

```sh
npx web-ext run --source-dir .
npx web-ext lint --source-dir . --ignore-files "tools/**" "dist/**"
```

または `about:debugging#/runtime/this-firefox` から `manifest.json` を選ぶ。

### 動作確認の見どころ

1. `example.com` にルールを作り、`example.com/xxx` でも効くこと
2. `example.org` には効かないこと
3. 同じサイトの中でルールの内と外を行き来し、そのつど倍率が変わること
   (オリジン単位の保存に負けていないかの確認)
4. Ctrl + ホイールで変えた倍率が、ページ移動まで残ること
5. アイコンの数字が実際の倍率と合っていること
6. `about:config` を開いてポップアップを出し、「設定できません」と出ること

背景ページのログは `about:debugging` の「調査」から開くコンソールに出る。

### アイコン

```sh
node tools/make-icons.js
```

### XPI の作成

```sh
node tools/build-xpi.js     # -> dist/su-zoom-<version>.xpi
```

`manifest.json` と `src/` だけを詰める。更新日時を固定しているので、内容が
同じなら毎回同じファイルができる。

### 署名

```powershell
powershell -ExecutionPolicy Bypass -File tools\sign.ps1
```

これだけでよい。`sign.ps1` は次を順にやる。

1. 鍵ファイルを読む
2. `node tools/sign.js` (アップロード → 署名待ち → ダウンロード)
3. 2 が失敗したら `node tools/fetch-signed.js` へ回る
   (アップロードは済んでいて取得だけ失敗した場合の救済。**バージョンは
   上げなくてよい**)
4. `dist/` の XPI を、中身を見て署名あり / なしを付けて並べる

`--channel unlisted` 固定で、AMO には公開されず署名済み XPI が `dist/` に出る。
署名には `browser_specific_settings.gecko.id` が使われる。この ID は AMO 上で
アカウントに永続的に紐づくので変更しないこと。

取得だけやり直したいときは:

```powershell
powershell -ExecutionPolicy Bypass -File toolsetch-signed.ps1 -List
powershell -ExecutionPolicy Bypass -File toolsetch-signed.ps1 -Version 2.0.0
```

#### 鍵の置き場所

資格情報はリポジトリに置かない。`ps1` が次の順に探し、最初に見つかった
ものを読み込む。

```
C:\projects\.keys\su-zoompikey.ps1
C:\projects\.keysollientpikey.ps1
```

中身は環境変数を 2 つ設定するだけ。AMO のキーは**アカウント単位**なので、
follient のものが su-zoom にもそのまま使える。今は 2 番目を使っており、
秘密をディスク上に二重に置いていない。鍵を分けたくなったら 1 番目を作れば
そちらが優先される。

```powershell
$env:AMO_JWT_ISSUER = "user:12345:67"
$env:AMO_JWT_SECRET = "..."
```

`ps1` は最後に `finally` でこの 2 つを環境から消す。

#### 配るのはどれか

`web-ext` が持ってくる署名済み XPI は AMO 側の名前 (16 進の文字列) になる。
`build-xpi.js` が作る `su-zoom-<版>.xpi` は**無署名**。取り違えないこと。

| ファイル | |
| --- | --- |
| `dist/63afd724542b4f3382df-<版>.xpi` | 署名あり。**これを配る** |
| `dist/su-zoom-<版>.xpi` | 無署名。手元での確認とハッシュ比較用 |

### PowerShell 5.1 は BOM の無い .ps1 を ANSI として読む

`tools/*.ps1` は**必ず UTF-8 BOM 付きで保存する**。BOM が無いと Windows
PowerShell 5.1 はファイルをシステムの ANSI コードページとして読み、
日本語のコメントや文字列が壊れて構文エラーになる。実際に
`Unexpected token '}'` という、原因の見当が付かないエラーが出た。

同じ理由で、`Get-Content` で UTF-8 のファイルを読むときは
`-Encoding UTF8` を明示する。`manifest.json` をこれ無しで読んで
`ConvertFrom-Json` に渡し、`description` が化けて失敗した。
