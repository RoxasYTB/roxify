#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Monitor GitHub Actions hotfix build, download binary, and run tests
.DESCRIPTION
    Polls GitHub Actions API for Windows Hotfix Build completion
    Downloads artifact when ready and runs comprehensive tests
    Shows progress with live updates
#>

param(
    [int]$CheckIntervalSeconds = 10,
    [int]$TimeoutMinutes = 60,
    [int]$TestRuns = 3,
    [string]$TestFile = "d:\C\Users\Yohan\Desktop\Weee.png"
)

$StopWatch = [System.Diagnostics.Stopwatch]::StartNew()
$WorkDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ArtifactDir = "$WorkDir\test_artifacts"
$BinaryPath = "$ArtifactDir\roxify_native-windows-x64.exe"

function Get-LatestWorkflowRun {
    try {
        $uri = "https://api.github.com/repos/RoxasYTB/roxify/actions/runs?status=in_progress&head_branch=main&limit=5"
        $runs = Invoke-RestMethod $uri -ErrorAction Stop
        return $runs.workflow_runs | Where-Object { $_.name -eq "Windows Hotfix Build" } | Select-Object -First 1
    } catch {
        return $null
    }
}

function Get-ArtifactDownloadUrl {
    param([string]$RunId)
    try {
        $artifacts = Invoke-RestMethod "https://api.github.com/repos/RoxasYTB/roxify/actions/runs/$RunId/artifacts" -ErrorAction Stop
        $artifact = $artifacts.artifacts | Where-Object { $_.name -like "*windows-x64*" -and $_.status -eq "completed" } | Select-Object -First 1
        return $artifact.archive_download_url
    } catch {
        return $null
    }
}

function Monitor-And-Download {
    Write-Host @"
╔════════════════════════════════════════════════════════════════╗
║                GitHub Actions Monitor                          ║
║                                                                ║
║  Watching for: Windows Hotfix Build (roxify v1.14.6-hotfix.1) ║
║  Timeout: ${TimeoutMinutes} minutes                                  ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`n
"@

    New-Item -ItemType Directory -Force $ArtifactDir -ErrorAction SilentlyContinue | Out-Null

    $lastStatus = ""
    $checkCount = 0

    while ($StopWatch.Elapsed.TotalMinutes -lt $TimeoutMinutes) {
        $run = Get-LatestWorkflowRun
        $checkCount++
        $elapsed = [int]$StopWatch.Elapsed.TotalSeconds

        if ($run) {
            $status = $run.status
            $conclusion = $run.conclusion

            if ($status -ne $lastStatus) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Status: $status | Conclusion: $conclusion | Elapsed: ${elapsed}s"
                $lastStatus = $status
            }

            if ($status -eq "completed" -and $conclusion -eq "success") {
                Write-Host "`n✅ Build completed successfully!`n"

                Write-Host "📥 Downloading artifact..."
                $artifactUrl = Get-ArtifactDownloadUrl $run.id

                if ($artifactUrl) {
                    try {
                        $zipPath = "$ArtifactDir\artifact.zip"
                        Invoke-WebRequest -Uri $artifactUrl -OutFile $zipPath -ErrorAction Stop
                        Expand-Archive -Path $zipPath -DestinationPath $ArtifactDir -Force -ErrorAction Stop
                        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

                        if (Test-Path $BinaryPath) {
                            Write-Host "✅ Binary ready: $BinaryPath`n"
                            return $true
                        }
                    } catch {
                        Write-Host "⚠️  Download issue: $_"
                    }
                }
                return $false
            } elseif ($status -eq "completed") {
                Write-Host "`n❌ Build failed with conclusion: $conclusion`n"
                return $false
            }
        } else {
            if ($checkCount % 6 -eq 0) {  # Show every 60 seconds
                Write-Host "⏳ Checking... (${elapsed}s elapsed)"
            }
        }

        Start-Sleep -Seconds $CheckIntervalSeconds
    }

    Write-Host "`n❌ Timeout: No completed build found after $TimeoutMinutes minutes`n"
    return $false
}

function Run-TestCycles {
    if (-not (Test-Path $TestFile)) {
        Write-Host "❌ Test file not found: $TestFile"
        return $false
    }

    if (-not (Test-Path $BinaryPath)) {
        Write-Host "❌ Binary not found: $BinaryPath"
        return $false
    }

    Write-Host @"
╔════════════════════════════════════════════════════════════════╗
║                Test Execution                                  ║
║                                                                ║
║  Runs: $TestRuns cycles (each: decode → encode → verify)
║  File: $(Split-Path -Leaf $TestFile) ($(Format-Size (Get-Item $TestFile).Length))
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`n
"@

    $TestDir = "$ArtifactDir\test_results"
    New-Item -ItemType Directory -Force $TestDir -ErrorAction SilentlyContinue | Out-Null

    $passed = 0
    $failed = 0

    for ($i = 1; $i -le $TestRuns; $i++) {
        $runDir = "$TestDir\run_$i"
        New-Item -ItemType Directory -Force $runDir -ErrorAction SilentlyContinue | Out-Null

        Write-Host "Test Cycle #$i / $TestRuns"
        Write-Host "─" * 60

        $decodedDir = "$runDir\decoded"
        $reencoded = "$runDir\reencoded.png"

        try {
            Write-Host "  [1/3] 🔓 Decoding..."
            & $BinaryPath decode $TestFile $decodedDir 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Decode failed" }
            Write-Host "        ✅ Success"

            Write-Host "  [2/3] 📦 Re-encoding..."
            & $BinaryPath encode $decodedDir $reencoded -l 3 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Encode failed" }
            Write-Host "        ✅ Success"

            Write-Host "  [3/3] 📊 Verification..."
            $origSize = (Get-Item $TestFile).Length
            $reencSize = (Get-Item $reencoded).Length
            Write-Host "        Original PNG: $(Format-Size $origSize)"
            Write-Host "        Re-enc PNG:   $(Format-Size $reencSize)"
            Write-Host "        ✅ Complete`n"

            $passed++
        } catch {
            Write-Host "        ❌ Failed: $_`n"
            $failed++
        }
    }

    Write-Host "╔════════════════════════════════════════════════════════════════╗"
    Write-Host "║                      FINAL RESULTS                             ║"
    Write-Host "╠════════════════════════════════════════════════════════════════╣"
    Write-Host "║  ✅ Passed: $passed / $TestRuns"
    Write-Host "║  ❌ Failed: $failed / $TestRuns"
    Write-Host "║                                                                ║"

    if ($passed -eq $TestRuns) {
        Write-Host "║  🎉 SUCCESS - Hotfix working correctly on Windows!         ║"
    } elseif ($passed -gt 0) {
        Write-Host "║  ⚠️  PARTIAL - Some cycles failed, check logs             ║"
    } else {
        Write-Host "║  ❌ FAILURE - All cycles failed                            ║"
    }

    Write-Host "║                                                                ║"
    Write-Host "╚════════════════════════════════════════════════════════════════╝"

    return $passed -eq $TestRuns
}

function Format-Size {
    param([long]$bytes)
    if ($bytes -lt 1KB) { return "$bytes B" }
    elseif ($bytes -lt 1MB) { return "{0:F2} KB" -f ($bytes / 1KB) }
    elseif ($bytes -lt 1GB) { return "{0:F2} MB" -f ($bytes / 1MB) }
    else { return "{0:F2} GB" -f ($bytes / 1GB) }
}

if (Monitor-And-Download) {
    if (Run-TestCycles) {
        Write-Host "`n✅ Hotfix validation complete! Ready for release.`n"
        exit 0
    }
}

Write-Host "`n❌ Hotfix validation failed.`n"
exit 1
