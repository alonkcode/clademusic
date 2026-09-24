# One-time setup that wires the hourly QA job to the test-runs edge function.
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-test-runs.ps1
# Needs the Supabase CLI (logged in) and gh (logged in with access to $repo).

$ErrorActionPreference = 'Stop'

$ref  = 'jlmddkchldgcjmdpvibm'
$repo = 'kaospan/clademusic'
$url  = "https://$ref.supabase.co"

function Step($name, [scriptblock]$body) {
  Write-Host "==> $name" -ForegroundColor Cyan
  & $body
  if ($LASTEXITCODE -ne 0) { throw "FAILED: $name (exit code $LASTEXITCODE)" }
}

$token = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
if ($token.Length -ne 64) { throw 'FAILED: could not generate a token (is node on PATH?)' }

Step 'Set CI_TEST_REPORT_TOKEN on the Supabase project' {
  npx.cmd supabase secrets set "CI_TEST_REPORT_TOKEN=$token" --project-ref $ref
}
Step 'Deploy the test-runs edge function' {
  npx.cmd supabase functions deploy test-runs --project-ref $ref
}
Step "Set CI_TEST_REPORT_TOKEN on GitHub ($repo)" {
  $token | gh secret set CI_TEST_REPORT_TOKEN -R $repo
}
Step "Set STAGING_URL on GitHub ($repo)" {
  $url | gh secret set STAGING_URL -R $repo
}

Write-Host '==> Probe the deployed function (401 = deployed and rejecting bad tokens, which is correct)' -ForegroundColor Cyan
try {
  Invoke-WebRequest -Uri "$url/functions/v1/test-runs" -Method Post -Body '{}' -ContentType 'application/json' -UseBasicParsing | Out-Null
  Write-Host 'Unexpected 2xx - the function accepted an unauthenticated POST.' -ForegroundColor Yellow
} catch {
  Write-Host "HTTP $([int]$_.Exception.Response.StatusCode)"
}
Write-Host 'Done. Tell Claude "next".' -ForegroundColor Green
