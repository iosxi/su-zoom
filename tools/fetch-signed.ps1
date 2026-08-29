<#
  署名済み XPI の取得だけをやり直す。

      powershell -ExecutionPolicy Bypass -File tools\fetch-signed.ps1
      powershell -ExecutionPolicy Bypass -File tools\fetch-signed.ps1 -List
      powershell -ExecutionPolicy Bypass -File tools\fetch-signed.ps1 -Version 2.0.0

  アップロードが済んでいれば署名はできているので、バージョンは上げなくてよい。
  資格情報の探しかたは sign.ps1 と同じ。
#>
param(
  [string]$Version,
  [switch]$List
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$keyFile = @(
  'C:\projects\.keys\su-zoom\apikey.ps1',
  'C:\projects\.keys\follient\apikey.ps1'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $keyFile) {
  Write-Host 'apikey.ps1 が見つかりません。tools\sign.ps1 の説明を見てください。' -ForegroundColor Red
  exit 1
}

Write-Host ('鍵: ' + $keyFile)
. $keyFile

try {
  Push-Location $root
  if ($List) {
    node tools\fetch-signed.js --list
  }
  elseif ($Version) {
    node tools\fetch-signed.js $Version
  }
  else {
    node tools\fetch-signed.js
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Pop-Location
  Remove-Item Env:AMO_JWT_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:AMO_JWT_ISSUER -ErrorAction SilentlyContinue
}
