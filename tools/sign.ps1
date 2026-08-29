<#
  AMO で署名して、配布できる XPI を dist/ に置く。

      powershell -ExecutionPolicy Bypass -File tools\sign.ps1

  資格情報はこのファイルには書かない。C:\projects\.keys\ に置いた
  apikey.ps1 ($env:AMO_JWT_ISSUER と $env:AMO_JWT_SECRET を設定するだけの
  ファイル) を読み込む。AMO のキーはアカウント単位なので、su-zoom 用の
  ものが無ければ follient のものをそのまま使う。

  sign.js はアップロード -> 署名待ち -> ダウンロード の順に進む。
  アップロードが済んだ後にダウンロードだけ失敗することがあるので、
  その場合は fetch-signed.js で取得だけやり直す。バージョンは上げなくてよい。
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# ---- 資格情報 ---------------------------------------------------------------

$keyCandidates = @(
  'C:\projects\.keys\su-zoom\apikey.ps1',
  'C:\projects\.keys\follient\apikey.ps1'
)
$keyFile = $keyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $keyFile) {
  Write-Host '鍵が見つかりません。次のどれかに apikey.ps1 を置いてください:' -ForegroundColor Red
  $keyCandidates | ForEach-Object { Write-Host ('  ' + $_) }
  Write-Host ''
  Write-Host '中身 (キーの発行: https://addons.mozilla.org/developers/addon/api/key/):'
  Write-Host '  $env:AMO_JWT_ISSUER = "user:12345:67"'
  Write-Host '  $env:AMO_JWT_SECRET = "..."'
  exit 1
}

Write-Host ('鍵: ' + $keyFile)
. $keyFile

if (-not $env:AMO_JWT_ISSUER -or -not $env:AMO_JWT_SECRET) {
  Write-Host '鍵ファイルが AMO_JWT_ISSUER / AMO_JWT_SECRET を設定していません。' -ForegroundColor Red
  exit 1
}

# PowerShell 5.1 の Get-Content は BOM の無いファイルを ANSI として読む。
# manifest.json は UTF-8 なので、必ず -Encoding UTF8 を付ける。
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host ('版:   ' + $manifest.version)
Write-Host ''

# ---- 署名 -------------------------------------------------------------------

try {
  Push-Location $root

  node tools\sign.js
  $signed = $LASTEXITCODE -eq 0

  if (-not $signed) {
    Write-Host ''
    Write-Host 'sign.js が失敗しました。すでにアップロード済みで、取得だけ' -ForegroundColor Yellow
    Write-Host '失敗した場合に備えて fetch-signed.js を試します。' -ForegroundColor Yellow
    Write-Host ''
    node tools\fetch-signed.js $manifest.version
    if ($LASTEXITCODE -ne 0) {
      Write-Host ''
      Write-Host '署名済み XPI を取得できませんでした。' -ForegroundColor Red
      Write-Host 'AMO 側の状態は次で確認できます: node tools\fetch-signed.js --list'
      exit 1
    }
  }

  # web-ext は署名済み XPI に AMO 側の名前 (16進の文字列) を付ける。
  # build-xpi.js が作る su-zoom-<版>.xpi は無署名なので、配るほうを間違えない
  # よう、中身を見て署名の有無を出す。
  Write-Host ''
  Write-Host 'dist の中身:'
  Get-ChildItem (Join-Path $root 'dist') -Filter *.xpi |
    Sort-Object LastWriteTime |
    ForEach-Object {
      $raw = [System.Text.Encoding]::GetEncoding(28591).GetString([System.IO.File]::ReadAllBytes($_.FullName))
      if ($raw.Contains('META-INF/mozilla.rsa')) { $mark = '署名あり <- これを配る' } else { $mark = '署名なし' }
      Write-Host ('  {0,-34} {1,7} bytes  {2}' -f $_.Name, $_.Length, $mark)
    }
}
finally {
  Pop-Location
  # 秘密をこのプロセスに残さない
  Remove-Item Env:AMO_JWT_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:AMO_JWT_ISSUER -ErrorAction SilentlyContinue
}
