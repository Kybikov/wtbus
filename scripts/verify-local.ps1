[CmdletBinding()]
param(
  [string]$WebBaseUrl = "http://localhost:3001",
  [string]$APIBaseUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $repositoryRoot ".env"
if (-not (Test-Path -LiteralPath $environmentPath)) {
  throw "Missing local environment file: $environmentPath"
}

$values = @{}
Get-Content -LiteralPath $environmentPath | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"')
  }
}

$email = $values["BOOTSTRAP_OWNER_EMAIL"]
$password = $values["BOOTSTRAP_OWNER_PASSWORD"]
if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrWhiteSpace($password)) {
  throw "BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD must be set in .env."
}

foreach ($path in @("/healthz", "/readyz")) {
  $response = Invoke-WebRequest -Uri ($APIBaseUrl.TrimEnd("/") + $path) -UseBasicParsing
  if ($response.StatusCode -ne 200) {
    throw "API $path returned $($response.StatusCode), expected 200."
  }
}

try {
  $anonymousResponse = Invoke-WebRequest -Uri ($WebBaseUrl.TrimEnd("/") + "/trips") -MaximumRedirection 0 -UseBasicParsing
  $anonymousStatus = $anonymousResponse.StatusCode
} catch {
  $anonymousStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
}
if ($anonymousStatus -ne 307) {
  throw "Unauthenticated CRM route returned $anonymousStatus, expected 307 redirect to login."
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-WebRequest `
  -Method Post `
  -Uri ($WebBaseUrl.TrimEnd("/") + "/api/auth/login") `
  -WebSession $session `
  -ContentType "application/json" `
  -Body (@{ email = $email; password = $password } | ConvertTo-Json) `
  -UseBasicParsing
if ($login.StatusCode -ne 200) {
  throw "BFF login returned $($login.StatusCode), expected 200."
}

$checks = @(
  @{ path = "/api/auth/me"; expected = 200 },
  @{ path = "/api/dashboard"; expected = 200 },
  @{ path = "/api/trips?date=" + (Get-Date -Format "yyyy-MM-dd"); expected = 200 },
  @{ path = "/api/trip-resources"; expected = 200 },
  @{ path = "/api/routes"; expected = 200 },
  @{ path = "/api/availability-blocks"; expected = 200 },
  @{ path = "/api/fleet"; expected = 200 },
  @{ path = "/api/customers?limit=10"; expected = 200 },
  @{ path = "/api/custom-fields"; expected = 200 },
  @{ path = "/api/bookings?limit=10"; expected = 200 },
  @{ path = "/api/individual-transfer-requests?limit=10"; expected = 200 },
  @{ path = "/api/finance?from=" + (Get-Date -Day 1 -Format "yyyy-MM-dd") + "&to=" + (Get-Date).AddMonths(1).AddDays(-1).ToString("yyyy-MM-dd"); expected = 200 },
  @{ path = "/api/branding"; expected = 200 },
  @{ path = "/api/payment-settings"; expected = 200 },
  @{ path = "/api/team"; expected = 200 },
  @{ path = "/api/preferences"; expected = 200 },
  @{ path = "/api/driver-cash"; expected = 403 }
)

$failures = @()
foreach ($check in $checks) {
  $actual = 0
  try {
    $actual = (Invoke-WebRequest -Uri ($WebBaseUrl.TrimEnd("/") + $check.path) -WebSession $session -UseBasicParsing).StatusCode
  } catch {
    if ($_.Exception.Response) {
      $actual = [int]$_.Exception.Response.StatusCode
    }
  }
  if ($actual -ne $check.expected) {
    $failures += "$($check.path): expected $($check.expected), got $actual"
  }
}

if ($failures.Count -gt 0) {
  throw ("Local acceptance check failed:`n" + ($failures -join "`n"))
}

$pages = @("/", "/trips", "/routes", "/availability", "/fleet", "/customers", "/bookings", "/requests", "/finance", "/team", "/settings", "/driver")
foreach ($path in $pages) {
  $response = Invoke-WebRequest -Uri ($WebBaseUrl.TrimEnd("/") + $path) -WebSession $session -UseBasicParsing
  if ($response.StatusCode -ne 200) {
    throw "Authenticated CRM page $path returned $($response.StatusCode), expected 200."
  }
}

Write-Output "Local acceptance check passed: API health, CRM routes, authenticated BFF, and owner/driver RBAC boundaries are healthy."
