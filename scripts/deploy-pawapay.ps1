# Deploy PawaPay ClickPro — même projet que Taxi des affaires
param(
    [string]$ProjectRef = "ngcjwhmjontbytzlzzlh",
    [switch]$SetSecrets,
    [string]$PawaPayApiToken = $env:PAWAPAY_API_TOKEN,
    [string]$PawaPayBaseUrl = $(if ($env:PAWAPAY_BASE_URL) { $env:PAWAPAY_BASE_URL } else { "https://api.pawapay.io" }),
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

# Charge .env local, sinon celui de Taxi des affaires (token déjà configuré)
$candidates = @(
    $EnvFile,
    (Join-Path $Root ".env"),
    "C:\Users\totoa\Desktop\taxi des affaires\.env"
) | Where-Object { $_ -and (Test-Path $_) }

foreach ($f in $candidates) {
    foreach ($line in Get-Content $f) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $k, $v = $line -split '=', 2
        $k = $k.Trim()
        $v = $v.Trim().Trim('"')
        if ($k -and -not [string]::IsNullOrWhiteSpace($v)) {
            Set-Item -Path "env:$k" -Value $v
        }
    }
    break
}

if (-not $PawaPayApiToken -and $env:PAWAPAY_API_TOKEN) {
    $PawaPayApiToken = $env:PAWAPAY_API_TOKEN
}
if ($env:PAWAPAY_BASE_URL) { $PawaPayBaseUrl = $env:PAWAPAY_BASE_URL }

# Callback déjà configuré côté dashboard PawaPay (Taxi)
$CallbackUrl = "https://$ProjectRef.supabase.co/functions/v1/pawapay-webhook"

Write-Host "=== Deploy PawaPay ClickPro Drive ===" -ForegroundColor Cyan
Write-Host "Project : $ProjectRef"
Write-Host "Base URL: $PawaPayBaseUrl"
Write-Host "Callback: $CallbackUrl"
Write-Host ""

Write-Host "1) Deploy functions..." -ForegroundColor Cyan
npx.cmd supabase functions deploy pawapay-deposit --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx.cmd supabase functions deploy pawapay-status --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Webhook Taxi (ne pas écraser sans --no-verify-jwt) : déployer depuis Taxi si besoin
Write-Host "Note: pawapay-webhook reste celui de Taxi des affaires ($CallbackUrl)" -ForegroundColor Yellow

if ($SetSecrets) {
    if (-not $PawaPayApiToken) {
        Write-Host "PAWAPAY_API_TOKEN manquant." -ForegroundColor Red
        exit 1
    }
    Write-Host "2) Set secrets..." -ForegroundColor Cyan
    npx.cmd supabase secrets set `
        "PAWAPAY_API_TOKEN=$PawaPayApiToken" `
        "PAWAPAY_BASE_URL=$PawaPayBaseUrl" `
        "PAWAPAY_CALLBACK_URL=$CallbackUrl" `
        --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "2) Secrets: .\scripts\deploy-pawapay.ps1 -SetSecrets" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Checklist:" -ForegroundColor Green
Write-Host "  [ ] node supabase/apply-pawapay-bridge.mjs"
Write-Host "  [ ] Secrets PAWAPAY_* (prod api.pawapay.io)"
Write-Host "  [ ] Dashboard callback = $CallbackUrl"
Write-Host "  [ ] Test recharge app ClickPro → PIN → solde wallet_balance"
Write-Host ""
Write-Host "Deploy termine." -ForegroundColor Green
