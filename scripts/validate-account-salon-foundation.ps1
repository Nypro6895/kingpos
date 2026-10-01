param(
  [switch]$SkipAppChecks
)

$ErrorActionPreference = "Stop"
$env:SUPABASE_TELEMETRY_DISABLED = "1"

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,

    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "==> $Label"
  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw "Step failed ($LASTEXITCODE): $Label"
  }
}

Invoke-Step "Start local Supabase runtime" {
  npx supabase start
}

Invoke-Step "Show local Supabase status" {
  npx supabase status
}

Invoke-Step "Clean reset local database through Account-Salon baseline" {
  npx supabase db reset --local --no-seed
}

Invoke-Step "Database lint" {
  npx supabase db lint --local
}

Invoke-Step "Account-Salon create salon contract test" {
  npx supabase db query --local --file supabase/tests/account_salon_create_salon_contract.sql
}

Invoke-Step "Account-Salon identity and RLS gate test" {
  npx supabase db query --local --file supabase/tests/account_salon_identity_rls_gate.sql
}

Invoke-Step "Account-Salon lifecycle foundation test" {
  npx supabase db query --local --file supabase/tests/account_salon_lifecycle_foundation.sql
}

Invoke-Step "Account deletion flow test" {
  npx supabase db query --local --file supabase/tests/account_deletion_flow.sql
}

Invoke-Step "Account lifecycle Phase 3 test" {
  npx supabase db query --local --file supabase/tests/account_lifecycle_phase3.sql
}

Invoke-Step "Regenerate Supabase types from local baseline schema" {
  $generatedTypes = npx supabase gen types typescript --local

  if ($LASTEXITCODE -ne 0) {
    throw "Supabase type generation failed."
  }

  Set-Content -LiteralPath "types/supabase.ts" -Value $generatedTypes -Encoding utf8
}

if (-not $SkipAppChecks) {
  Invoke-Step "Salon creation routing contract" {
    node scripts/verify-salon-creation-routing.mjs
  }

  Invoke-Step "Lint" {
    npm run lint
  }

  Invoke-Step "Typecheck" {
    npx tsc --noEmit --pretty false
  }

  Invoke-Step "Build" {
    npm run build
  }

  Invoke-Step "Diff whitespace check" {
    git diff --check
  }
}
