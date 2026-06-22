Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

function Read-EnvMap {
  param([string[]]$Paths)

  $map = @{}
  foreach ($path in $Paths) {
    if (-not (Test-Path $path)) {
      continue
    }

    foreach ($line in Get-Content -Path $path -Encoding UTF8) {
      $trimmed = $line.Trim()
      if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
        continue
      }

      $parts = $trimmed -split "=", 2
      if ($parts.Count -lt 2) {
        continue
      }

      $key = $parts[0].Trim()
      $value = $parts[1].Trim()
      $value = [regex]::Replace($value, "\s+#.*$", "").Trim()
      if ($key.Length -gt 0) {
        $map[$key] = $value
      }
    }
  }

  return $map
}

$orderedKeys = @(
  "DATABASE_URL",
  "BASE_URL",
  "ADMIN_BASIC_USER",
  "ADMIN_BASIC_PASS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "BACKUP_EXPORT_SECRET",
  "RATE_LIMIT_HASH_SECRET",
  "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY",
  "BANK_ACCOUNT_HISTORY_KEY_VERSION",
  "STORE_NOTIFY_EMAIL",
  "EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
  "ADMIN_EMAIL",
  "STORE_NAME",
  "CONTACT_PHONE_E164",
  "CONTACT_PHONE_DISPLAY",
  "CONTACT_MESSAGE",
  "NEXT_PUBLIC_CONTACT_PHONE_E164",
  "NEXT_PUBLIC_CONTACT_PHONE_DISPLAY",
  "NEXT_PUBLIC_CONTACT_MESSAGE",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_CHANNEL_SECRET",
  "LINE_LOGIN_CHANNEL_ID",
  "NEXT_PUBLIC_LIFF_BOOKING_ID",
  "NEXT_PUBLIC_LIFF_LINK_ID",
  "LINE_LINK_TOKEN_PEPPER",
  "LINE_MONTHLY_REMINDER_LIMIT",
  "LINE_MONTHLY_REMINDER_WARN_THRESHOLD"
  # LIFF_ID は廃止。NEXT_PUBLIC_LIFF_BOOKING_ID / NEXT_PUBLIC_LIFF_LINK_ID を使う。
)

$requiredKeys = @(
  "DATABASE_URL",
  "BASE_URL",
  "ADMIN_BASIC_USER",
  "ADMIN_BASIC_PASS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "BACKUP_EXPORT_SECRET",
  "RATE_LIMIT_HASH_SECRET",
  "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY"
)

$envMap = Read-EnvMap -Paths @(
  (Join-Path $repoRoot ".env"),
  (Join-Path $repoRoot ".env.local")
)

foreach ($key in $orderedKeys) {
  $processValue = [System.Environment]::GetEnvironmentVariable($key)
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    $envMap[$key] = $processValue
  }
}

$missing = @()
foreach ($key in $requiredKeys) {
  if (-not $envMap.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$envMap[$key])) {
    $missing += $key
  }
}

if ($missing.Count -gt 0) {
  throw "Missing required values for Vercel: $($missing -join ', ')"
}

Write-Host "# Paste these into Vercel Production Environment Variables in this order" -ForegroundColor Cyan
Write-Host "# Secret values are masked. Enter or paste the real values directly in Vercel; do not print them in terminal logs." -ForegroundColor Yellow
foreach ($key in $orderedKeys) {
  if ($envMap.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace([string]$envMap[$key])) {
    Write-Output ("{0}=<set>" -f $key)
  }
}
