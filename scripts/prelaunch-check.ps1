param(
  [int]$Port = 3100
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

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

function Test-Placeholder {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $true
  }

  $normalized = $Value.ToLowerInvariant()
  $markers = @(
    "placeholder",
    "changeme",
    "your-",
    "your_",
    "<real",
    "<your-",
    "replace-with"
  )

  foreach ($marker in $markers) {
    if ($normalized.Contains($marker)) {
      return $true
    }
  }

  return $false
}

function Get-HttpMethod {
  param([string]$Method)

  switch ($Method) {
    "GET" { return [System.Net.Http.HttpMethod]::Get }
    "HEAD" { return [System.Net.Http.HttpMethod]::Head }
    "POST" { return [System.Net.Http.HttpMethod]::Post }
    default { throw "Unsupported HTTP method: $Method" }
  }
}

function Invoke-Http {
  param(
    [ValidateSet("GET", "HEAD", "POST")]
    [string]$Method,
    [string]$Url,
    [string]$Body = "",
    [hashtable]$Headers = @{}
  )

  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [System.Net.Http.HttpClient]::new($handler)

  try {
    $request = [System.Net.Http.HttpRequestMessage]::new((Get-HttpMethod -Method $Method), $Url)
    foreach ($key in $Headers.Keys) {
      if ($key -eq "Content-Type") {
        continue
      }
      $null = $request.Headers.TryAddWithoutValidation($key, [string]$Headers[$key])
    }

    if ($Method -eq "POST") {
      $contentType = if ($Headers.ContainsKey("Content-Type")) {
        [string]$Headers["Content-Type"]
      } else {
        "application/json"
      }
      $request.Content = [System.Net.Http.StringContent]::new(
        $Body,
        [System.Text.Encoding]::UTF8,
        $contentType
      )
    }

    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $headerMap = @{}

    foreach ($pair in $response.Headers) {
      $headerMap[$pair.Key] = ($pair.Value -join ", ")
    }

    foreach ($pair in $response.Content.Headers) {
      $headerMap[$pair.Key] = ($pair.Value -join ", ")
    }

    return [pscustomobject]@{
      Status  = [int]$response.StatusCode
      Headers = $headerMap
      Body    = $responseBody
    }
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

function Assert-Equal {
  param(
    [object]$Actual,
    [object]$Expected,
    [string]$Message
  )

  if ($Actual -ne $Expected) {
    throw "$Message Expected '$Expected' but got '$Actual'."
  }
}

function Assert-Contains {
  param(
    [string]$Actual,
    [string]$ExpectedFragment,
    [string]$Message
  )

  if ($null -eq $Actual -or -not $Actual.Contains($ExpectedFragment)) {
    throw "$Message Missing fragment '$ExpectedFragment'."
  }
}

function Get-RepoNodeProcesses {
  $escapedRepoRoot = [regex]::Escape($repoRoot)
  return @(
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $null -ne $_.CommandLine -and
        $_.CommandLine -match $escapedRepoRoot
      }
  )
}

function Wait-For-RepoNodeProcessesToExit {
  param(
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $processes = @(Get-RepoNodeProcesses)
    if ($processes.Count -eq 0) {
      return
    }

    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  $details = $processes | ForEach-Object {
    "PID $($_.ProcessId): $($_.CommandLine)"
  }
  throw "Repo node processes are still running and may lock Prisma. Stop these first: $($details -join ' | ')"
}

$requiredEnvKeys = @(
  "DATABASE_URL",
  "BASE_URL",
  "ADMIN_BASIC_USER",
  "ADMIN_BASIC_PASS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY"
)

$recommendedEnvKeys = @(
  "BANK_ACCOUNT_HISTORY_KEY_VERSION",
  "CONTACT_PHONE_E164",
  "CONTACT_PHONE_DISPLAY",
  "CONTACT_MESSAGE",
  "NEXT_PUBLIC_CONTACT_PHONE_E164",
  "NEXT_PUBLIC_CONTACT_PHONE_DISPLAY",
  "NEXT_PUBLIC_CONTACT_MESSAGE",
  "STORE_NOTIFY_EMAIL",
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "ADMIN_EMAIL",
  "STORE_NAME",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_CHANNEL_SECRET",
  "LIFF_ID"
)

$serverProcess = $null
$serverProcessId = $null
$runId = [Guid]::NewGuid().ToString("N")
$stdoutLog = Join-Path $env:TEMP "bistro-prelaunch-$Port-$runId.out.log"
$stderrLog = Join-Path $env:TEMP "bistro-prelaunch-$Port-$runId.err.log"

try {
  Set-Location $repoRoot

  Write-Step "Checking launch environment"
  $envMap = Read-EnvMap -Paths @(
    (Join-Path $repoRoot ".env"),
    (Join-Path $repoRoot ".env.local")
  )
  $keysToResolve = ($requiredEnvKeys + $recommendedEnvKeys + @(
    "EMAIL_API_KEY",
    "RESEND_API_KEY"
  )) | Select-Object -Unique

  foreach ($key in $keysToResolve) {
    $processValue = [System.Environment]::GetEnvironmentVariable($key)
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
      $envMap[$key] = $processValue
    }
  }

  $missing = @()
  foreach ($key in $requiredEnvKeys) {
    if (-not $envMap.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$envMap[$key])) {
      $missing += $key
    }
  }

  if ($missing.Count -gt 0) {
    throw "Missing required env keys: $($missing -join ', ')"
  }

  $placeholderKeys = @(@(
    "ADMIN_BASIC_USER",
    "ADMIN_BASIC_PASS",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY"
  ) | Where-Object { Test-Placeholder -Value ([string]$envMap[$_]) })

  if ($placeholderKeys.Count -gt 0) {
    throw "Placeholder values detected: $($placeholderKeys -join ', ')"
  }

  $recommendedMissing = @()
  foreach ($key in $recommendedEnvKeys) {
    if (-not $envMap.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$envMap[$key])) {
      $recommendedMissing += $key
    }
  }

  if ($recommendedMissing.Count -gt 0) {
    Write-Host "WARN: Recommended env keys are missing: $($recommendedMissing -join ', ')" -ForegroundColor Yellow
  }

  $recommendedPlaceholderKeys = @(@(
    "STORE_NOTIFY_EMAIL",
    "EMAIL_FROM"
  ) | Where-Object {
    $envMap.ContainsKey($_) -and
    -not [string]::IsNullOrWhiteSpace([string]$envMap[$_]) -and
    (Test-Placeholder -Value ([string]$envMap[$_]))
  })

  if ($recommendedPlaceholderKeys.Count -gt 0) {
    Write-Host "WARN: Recommended env keys still look like placeholders: $($recommendedPlaceholderKeys -join ', ')" -ForegroundColor Yellow
  }

  if ($envMap.ContainsKey("EMAIL_PROVIDER")) {
    $provider = [string]$envMap["EMAIL_PROVIDER"]
    if ($provider -eq "resend" -and -not (
      ($envMap.ContainsKey("RESEND_API_KEY") -and -not (Test-Placeholder -Value ([string]$envMap["RESEND_API_KEY"])) ) -or
      ($envMap.ContainsKey("EMAIL_API_KEY") -and -not (Test-Placeholder -Value ([string]$envMap["EMAIL_API_KEY"])) )
    )) {
      throw "EMAIL_PROVIDER=resend requires RESEND_API_KEY or EMAIL_API_KEY."
    }

    if ($provider -eq "sendgrid" -and (
      -not $envMap.ContainsKey("EMAIL_API_KEY") -or
      (Test-Placeholder -Value ([string]$envMap["EMAIL_API_KEY"]))
    )) {
      throw "EMAIL_PROVIDER=sendgrid requires EMAIL_API_KEY."
    }
  }

  Write-Step "Running lint"
  & npm.cmd run lint
  if ($LASTEXITCODE -ne 0) {
    throw "npm run lint failed."
  }

  Write-Step "Running tests"
  & npm.cmd run test
  if ($LASTEXITCODE -ne 0) {
    throw "npm run test failed."
  }

  Wait-For-RepoNodeProcessesToExit

  Write-Step "Running production build"
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed."
  }

  Write-Step "Starting production server on port $Port"
  $existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -ne $existingListener) {
    throw "Port $Port is already in use by PID $($existingListener.OwningProcess)."
  }

  $serverProcess = Start-Process -FilePath "npm.cmd" `
    -ArgumentList "run", "start", "--", "-p", "$Port" `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  $rootUrl = "http://localhost:$Port"
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $probe = Invoke-Http -Method "HEAD" -Url "$rootUrl/"
      if ($probe.Status -ge 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  if (-not $ready) {
    throw "Production server did not become ready on port $Port."
  }

  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $listener) {
    throw "Could not resolve the process listening on port $Port."
  }
  $serverProcessId = $listener.OwningProcess

  Write-Step "Running smoke checks"

  $aiAlias = Invoke-Http -Method "HEAD" -Url "$rootUrl/ai"
  Assert-Equal -Actual $aiAlias.Status -Expected 308 -Message "/ai must be a permanent redirect."
  Assert-Equal -Actual $aiAlias.Headers["Location"] -Expected "/agents" -Message "/ai must redirect to /agents."

  $aiSwitch = Invoke-Http -Method "HEAD" -Url "$rootUrl/?ai=1"
  Assert-Equal -Actual $aiSwitch.Status -Expected 307 -Message "/?ai=1 must be a temporary redirect."
  Assert-Equal -Actual $aiSwitch.Headers["Location"] -Expected "/agents" -Message "/?ai=1 must redirect to /agents."

  $homeResponse = Invoke-Http -Method "HEAD" -Url "$rootUrl/"
  Assert-Equal -Actual $homeResponse.Status -Expected 200 -Message "Home page must respond."
  Assert-Contains -Actual ([string]$homeResponse.Headers["Link"]) -ExpectedFragment "</agents>" -Message "Home page must advertise /agents."
  Assert-Contains -Actual ([string]$homeResponse.Headers["Link"]) -ExpectedFragment "</llms.txt>" -Message "Home page must advertise /llms.txt."
  Assert-Contains -Actual ([string]$homeResponse.Headers["Link"]) -ExpectedFragment "</api/agent>" -Message "Home page must advertise /api/agent."

  $admin = Invoke-Http -Method "HEAD" -Url "$rootUrl/admin/reservations"
  Assert-Equal -Actual $admin.Status -Expected 401 -Message "Admin reservations must require Basic auth."

  $manifest = Invoke-Http -Method "GET" -Url "$rootUrl/api/agent?pretty=1"
  Assert-Equal -Actual $manifest.Status -Expected 200 -Message "/api/agent must respond."
  Assert-Contains -Actual $manifest.Body -ExpectedFragment "`n" -Message "/api/agent?pretty=1 must be pretty-printed."
  Assert-Contains -Actual $manifest.Body -ExpectedFragment '"optional_headers"' -Message "Agent manifest must expose optional_headers."

  $reservationProbe = Invoke-Http -Method "POST" `
    -Url "$rootUrl/api/reservations" `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body "{}"
  Assert-Equal -Actual $reservationProbe.Status -Expected 400 -Message "Reservation probe should fail validation, not transport."
  Assert-Contains -Actual $reservationProbe.Body -ExpectedFragment '"code":"VALIDATION_ERROR"' -Message "Reservation probe must reach validation."

  Write-Step "Prelaunch check passed"
  Write-Host "All launch checks completed successfully." -ForegroundColor Green
  Write-Host "Logs: $stdoutLog"
  Write-Host "Logs: $stderrLog"
} finally {
  if ($null -ne $serverProcess) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($null -ne $serverProcessId) {
    Stop-Process -Id $serverProcessId -Force -ErrorAction SilentlyContinue
  }
}
