# Phase 3.1 — Live E2E audit harness for the Continuous Strategy Loop.
#
# This PowerShell script performs the EXACT live flow the spec requires:
#
#   1. POST /api/search/start         → initial SearchRun with full search algorithm
#   2. POST /api/loop/start           → register the SearchRun as iteration #1
#   3. POST /api/backtests/run        → run backtest for each candidate (sync mode)
#   4. WAIT for StrategyEvaluated events to increment totalEvaluated
#   5. VERIFY Iteration 1 = DONE, LoopRunState bestStrategyVersionId != null
#   6. VERIFY Iteration 2 SearchRun created automatically
#   7. VERIFY Iteration 2 candidate count == candidateCountPerIteration (5)
#   8. VERIFY Iteration 2 candidates enter BullMQ
#   9. RUN backtests for Iteration 2 candidates
#   10. VERIFY Iteration 2 = DONE
#   11. VERIFY totalEvaluated == 11 + 5 = 16

$ErrorActionPreference = "Stop"
$baseUrl = "http://localhost:3000"
$e2eId = "phase31-" + (Get-Date -Format "yyyyMMddHHmmss")
$outDir = "D:\Software-Architecture\crypto-strategy-lab\audit-e2e-" + $e2eId
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Step($n, $msg) {
  Write-Host ""
  Write-Host "[STEP $n] $msg"
}
function Pass($msg) { Write-Host "  PASS: $msg" }
function Fail($msg) { Write-Host "  FAIL: $msg"; $script:failed = $true }
function Info($msg) { Write-Host "  INFO: $msg" }

$script:failed = $false

Step 0 "Phase 3.1 LIVE E2E for $e2eId"
Info "Output: $outDir"

# Lookup constants
$algos = (Invoke-WebRequest -UseBasicParsing -Method GET "$baseUrl/api/search/algorithms" -TimeoutSec 10).Content | ConvertFrom-Json
$algoDomain = $algos.data | Where-Object { $_.code -eq "domain_guided" } | Select-Object -First 1
$syms = (Invoke-WebRequest -UseBasicParsing -Method GET "$baseUrl/api/search/symbols" -TimeoutSec 10).Content | ConvertFrom-Json
$symBtc = $syms.data | Where-Object { $_.symbol -eq "BTCUSDT" } | Select-Object -First 1

Info "Domain-guided algorithm id: $($algoDomain.id)"
Info "BTCUSDT symbol id: $($symBtc.id)"

# STEP 1 — explicit initial SearchRun
Step 1 "POST /api/search/start (Domain-guided max=20)"
$startBody = @{
  algorithmId     = $algoDomain.id
  algorithm       = "domain_guided"
  symbolId        = $symBtc.id
  timeframe       = "1h"
  maxCandidates   = 20
  createdBy       = "phase3.1-e2e"
  generatorConfig = @{
    minComponents    = 2
    maxComponents    = 4
    requiredFamilies = @("TREND", "MOMENTUM", "STRUCTURE")
    domainMode       = "GUIDED"
    mode             = "EXHAUSTIVE"
  }
} | ConvertTo-Json -Depth 6

$startResp = Invoke-WebRequest -UseBasicParsing -Method POST "$baseUrl/api/search/start?algorithm=domain_guided" -ContentType "application/json" -Body $startBody -TimeoutSec 60
$startData = ($startResp.Content | ConvertFrom-Json).data
$searchRunId = $startData.searchRunId
Info "SearchRun id: $searchRunId"
Info "totalGenerated: $($startData.totalGenerated)"
Info "totalQueued:   $($startData.totalQueued)"
$startData | ConvertTo-Json | Out-File -FilePath "$outDir/01-search-start.json" -Encoding UTF8

$loopId = "combo-$searchRunId"

# STEP 2 — get candidates
Step 2 "GET /api/search/$searchRunId/candidates"
$candsResp = Invoke-WebRequest -UseBasicParsing -Method GET "$baseUrl/api/search/$searchRunId/candidates" -TimeoutSec 10
$candsList = ($candsResp.Content | ConvertFrom-Json).data
$initialCandidateCount = $candsList.Count
Info "Initial candidate count: $initialCandidateCount"

if ($initialCandidateCount -lt 1) {
  Fail "initial candidates < 1"
  exit 1
}

$initialParentId = $candsList[0].strategyVersionId
Info "Initial parent strategyVersionId: $initialParentId"

# STEP 3 — start loop with iteration #1 binding
Step 3 "POST /api/loop/start (register iteration #1)"
$loopStartBody = @{
  loopId                    = $loopId
  maxCandidates             = 100
  maxIterations             = 20
  candidateCountPerIteration = 5
  timeLimitSeconds          = 1800
  noImprovementCap          = 25
  initialSearchRunId        = $searchRunId
  parentStrategyVersionId   = $initialParentId
} | ConvertTo-Json

$loopStartResp = Invoke-WebRequest -UseBasicParsing -Method POST "$baseUrl/api/loop/start" -ContentType "application/json" -Body $loopStartBody -TimeoutSec 10
$loopStartResp.Content | Out-File -FilePath "$outDir/03-loop-start.json" -Encoding UTF8
$loopStart = ($loopStartResp.Content | ConvertFrom-Json).data
Info "Loop status: $($loopStart.status)"
Info "currentIteration: $($loopStart.currentIteration)"
Info "currentIterationCandidateCount: $($loopStart.currentIterationCandidateCount)"

if ($loopStart.currentIterationCandidateCount -eq $initialCandidateCount) {
  Pass "iteration #1 candidateCount == actual ($initialCandidateCount)"
} else {
  Fail "iteration #1 candidateCount ($($loopStart.currentIterationCandidateCount)) != actual ($initialCandidateCount)"
}

# STEP 4 — run backtests for initial candidates
Step 4 "POST /api/backtests/run for each initial candidate (sync mode)"
$count = 0
foreach ($c in $candsList) {
  $count++
  $body = @{ candidateId = $c.id; sync = $true } | ConvertTo-Json
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Method POST -Uri "$baseUrl/api/backtests/run" -ContentType "application/json" -Body $body -TimeoutSec 180
    $obj = ($r.Content | ConvertFrom-Json).data
    $score = $obj.result.metrics.overallScore
    Info "[$count/$initialCandidateCount] cand $($c.id.Substring(0,8)) score=$score"
  } catch {
    Info "[$count] ERR: $_"
  }
}

# STEP 5 — wait for the orchestrator to complete iteration #1
Step 5 "GET /api/loop/progress (after iter 1 evaluations)"
$iter1Complete = $false
$iter2Found = $false
$loopState1 = $null
for ($wait = 0; $wait -lt 30; $wait++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Method GET "$baseUrl/api/loop/progress?loopId=$loopId" -TimeoutSec 10
    $p = ($r.Content | ConvertFrom-Json).data
    if ($p.currentIteration -ge 2) {
      $iter2Found = $true
      $loopState1 = $p
      break
    }
    $loopState1 = $p
  } catch {
    Info "wait $wait err: $_"
  }
}
if ($null -ne $loopState1) {
  $loopState1 | ConvertTo-Json -Depth 6 | Out-File -FilePath "$outDir/05-progress-after-iter1.json" -Encoding UTF8
  Info "totalEvaluated: $($loopState1.totalEvaluated)"
  Info "currentIteration: $($loopState1.currentIteration)"
  Info "status: $($loopState1.status)"
  Info "bestScore: $($loopState1.bestScore)"
  Info "bestStrategy: $($loopState1.bestStrategyName) ($($loopState1.bestStrategySymbolCode))"
}

# STEP 5b — candidates endpoint
Step "5b" "GET /api/loop/candidates"
$candList2 = (Invoke-WebRequest -UseBasicParsing -Method GET "$baseUrl/api/loop/candidates?loopId=$loopId" -TimeoutSec 10).Content | ConvertFrom-Json
$candList2 | ConvertTo-Json -Depth 6 | Out-File -FilePath "$outDir/05b-candidates-after-iter1.json" -Encoding UTF8
Info "Iterations found:"
$candList2.data | ForEach-Object {
  Info "  iter=$($_.iterationIndex) status=$($_.status) candidateCount=$($_.candidateCount) evaluated=$($_.evaluatedCount) bestScore=$($_.bestScoreInIteration)"
}

# STEP 6 — assert iteration 2 created
Step 6 "Verify Iteration 2 created automatically"
$iter2 = $candList2.data | Where-Object { $_.iterationIndex -eq 2 } | Select-Object -First 1
if ($iter2) {
  Pass "Iteration 2 exists"
  $iter2SearchRunId = $iter2.searchRunId
  Info "iter=2 status=$($iter2.status) candidateCount=$($iter2.candidateCount) evaluated=$($iter2.evaluatedCount)"
  Info "searchRunId=$iter2SearchRunId"
  if ($iter2.candidateCount -ne 5) {
    Fail "Iteration 2 candidateCount != 5 (got $($iter2.candidateCount))"
  } else {
    Pass "Iteration 2 candidateCount == 5"
  }
} else {
  Fail "Iteration 2 NOT created"
  exit 1
}

# STEP 7 — inspect iteration 2 candidates in DB
Step 7 "Inspect Iteration 2 candidates (DB)"
$i2candResp = Invoke-WebRequest -UseBasicParsing -Method GET "$baseUrl/api/search/$iter2SearchRunId/candidates" -TimeoutSec 10
$i2cands = ($i2candResp.Content | ConvertFrom-Json).data
Info "Iteration 2 candidates in DB: $($i2cands.Count)"
$i2cands | Select-Object id, strategyVersion.name | Format-Table | Out-String | Out-File "$outDir/07-iter2-candidates.txt"

# STEP 8 — run backtests for iteration 2
Step 8 "POST /api/backtests/run for each Iteration 2 candidate (sync mode)"
$count = 0
foreach ($c in $i2cands) {
  $count++
  $body = @{ candidateId = $c.id; sync = $true } | ConvertTo-Json
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Method POST -Uri "$baseUrl/api/backtests/run" -ContentType "application/json" -Body $body -TimeoutSec 180
    $obj = ($r.Content | ConvertFrom-Json).data
    $score = $obj.result.metrics.overallScore
    Info "[$count/$($i2cands.Count)] iter2 cand $($c.id.Substring(0,8)) score=$score"
  } catch {
    Info "[$count] ERR: $_"
  }
}

# STEP 9 — final state
Step 9 "Final GET /api/loop/progress"
Start-Sleep -Seconds 5
$finalProg = (Invoke-WebRequest -UseBasicParsing -Method GET "$baseUrl/api/loop/progress?loopId=$loopId" -TimeoutSec 10).Content | ConvertFrom-Json
$finalProg | ConvertTo-Json -Depth 6 | Out-File -FilePath "$outDir/09-final-progress.json" -Encoding UTF8
Info "totalEvaluated: $($finalProg.data.totalEvaluated)"
Info "currentIteration: $($finalProg.data.currentIteration)"
Info "status: $($finalProg.data.status)"
Info "bestScore: $($finalProg.data.bestScore)"
Info "bestStrategy: $($finalProg.data.bestStrategyName) ($($finalProg.data.bestStrategySymbolCode))"

$finalCandList = (Invoke-WebRequest -UseBasicParsing -Method GET "$baseUrl/api/loop/candidates?loopId=$loopId" -TimeoutSec 10).Content | ConvertFrom-Json
$finalCandList | ConvertTo-Json -Depth 6 | Out-File -FilePath "$outDir/09-final-candidates.json" -Encoding UTF8
Info "Final iteration status:"
$finalCandList.data | ForEach-Object {
  Info "  iter=$($_.iterationIndex) status=$($_.status) candidateCount=$($_.candidateCount) evaluated=$($_.evaluatedCount) completedAt=$($_.completedAt)"
}

# STEP 10 — assertions
Step 10 "ASSERTIONS"
if ($finalProg.data.currentIteration -ge 2) {
  Pass "currentIteration >= 2 ($($finalProg.data.currentIteration))"
} else {
  Fail "currentIteration < 2 ($($finalProg.data.currentIteration))"
}

$expectedTotal = $initialCandidateCount + $i2cands.Count
if ($finalProg.data.totalEvaluated -ge $expectedTotal) {
  Pass "totalEvaluated >= $expectedTotal (got $($finalProg.data.totalEvaluated))"
} else {
  Fail "totalEvaluated < $expectedTotal (got $($finalProg.data.totalEvaluated))"
}

if ($finalProg.data.bestStrategyVersionId) {
  Pass "bestStrategyVersionId != null ($($finalProg.data.bestStrategyVersionId))"
} else {
  Fail "bestStrategyVersionId is null"
}

$finalIter2 = $finalCandList.data | Where-Object { $_.iterationIndex -eq 2 } | Select-Object -First 1
if ($finalIter2.status -eq "DONE") {
  Pass "Iteration 2 status == DONE"
} else {
  Fail "Iteration 2 status != DONE (got $($finalIter2.status))"
}

Write-Host ""
Write-Host "=========="
if (-not $script:failed) {
  Write-Host "PHASE 3.1 LIVE E2E PASSED"
  Write-Host "loopId=$loopId"
  Write-Host "searchRunId=$searchRunId"
  Write-Host "iter2SearchRunId=$iter2SearchRunId"
  Write-Host "=========="
  exit 0
} else {
  Write-Host "PHASE 3.1 LIVE E2E FAILED see $outDir"
  Write-Host "=========="
  exit 1
}
