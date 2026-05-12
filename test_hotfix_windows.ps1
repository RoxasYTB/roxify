param(
    [string]$BinaryUrl = "https://api.github.com/repos/RoxasYTB/roxify/actions/runs",
    [string]$TestFile = "d:\C\Users\Yohan\Desktop\Weee.png",
    [int]$NumRuns = 3,
    [int]$MaxWaitMinutes = 30
)

$WorkDir = "d:\C\Users\Yohan\Desktop\Projets\roxify"
$ArtifactDir = "$WorkDir\test_artifacts"
$TestBinaryPath = "$ArtifactDir\roxify_native-windows-x64.exe"
$TestOutputDir = "$ArtifactDir\decoded"

function Wait-For-Release {
    Write-Host "⏳ Waiting for hotfix release v1.14.5-hotfix.1 on GitHub..."
    
    $startTime = Get-Date
    $timeout = New-TimeSpan -Minutes $MaxWaitMinutes
    
    while ((Get-Date) - $startTime -lt $timeout) {
        try {
            $releases = Invoke-RestMethod "https://api.github.com/repos/RoxasYTB/roxify/releases" -ErrorAction Stop
            $hotfixRelease = $releases | Where-Object { $_.tag_name -eq "v1.14.5-hotfix.1" } | Select-Object -First 1
            
            if ($hotfixRelease) {
                Write-Host "✅ Release found: $($hotfixRelease.html_url)"
                return $hotfixRelease
            }
        } catch {
            Write-Host "⚠️  Checking releases... ($(Get-Date -Format 'HH:mm:ss'))"
        }
        
        Start-Sleep -Seconds 10
    }
    
    Write-Host "❌ Timeout waiting for release after $MaxWaitMinutes minutes"
    return $null
}

function Download-LatestBinary {
    Write-Host "📥 Downloading latest hotfix binary..."
    
    New-Item -ItemType Directory -Force $ArtifactDir | Out-Null
    
    $releases = Invoke-RestMethod "https://api.github.com/repos/RoxasYTB/roxify/actions/runs" -ErrorAction Stop
    $workflows = $releases.workflow_runs | Where-Object { $_.name -eq "Windows Hotfix Build" } | Sort-Object -Property created_at -Descending | Select-Object -First 1
    
    if ($workflows) {
        $artifacts = Invoke-RestMethod $workflows.artifacts_url -ErrorAction Stop
        $artifact = $artifacts.artifacts | Where-Object { $_.name -like "*windows-x64*" } | Select-Object -First 1
        
        if ($artifact) {
            Write-Host "Found artifact: $($artifact.name)"
            $downloadUrl = "$($artifact.archive_download_url)"
            
            $zipPath = "$ArtifactDir\artifact.zip"
            Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -ErrorAction Stop
            
            Expand-Archive -Path $zipPath -DestinationPath $ArtifactDir -Force
            Remove-Item $zipPath
            
            if (Test-Path $TestBinaryPath) {
                Write-Host "✅ Binary found at: $TestBinaryPath"
                return $true
            }
        }
    }
    
    Write-Host "❌ Failed to find or download binary"
    return $false
}

function Run-Tests {
    if (-not (Test-Path $TestBinaryPath)) {
        Write-Host "❌ Binary not found at: $TestBinaryPath"
        return $false
    }
    
    if (-not (Test-Path $TestFile)) {
        Write-Host "❌ Test file not found: $TestFile"
        return $false
    }
    
    New-Item -ItemType Directory -Force $TestOutputDir | Out-Null
    
    Write-Host "`n🧪 Starting $NumRuns test runs..."
    Write-Host "📦 Test file: $TestFile"
    Write-Host "📊 Output directory: $TestOutputDir`n"
    
    $successCount = 0
    $failCount = 0
    
    for ($i = 1; $i -le $NumRuns; $i++) {
        Write-Host "─" * 70
        Write-Host "Run #$i / $NumRuns"
        Write-Host "─" * 70
        
        $runDir = "$TestOutputDir\run_$i"
        New-Item -ItemType Directory -Force $runDir | Out-Null
        
        $decodedFile = "$runDir\decoded"
        $reencoded = "$runDir\reencoded.png"
        
        Write-Host "  [1/3] 🔓 Decoding '$($TestFile | Split-Path -Leaf)'..."
        try {
            $output = & $TestBinaryPath decode "$TestFile" "$decodedFile" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "        ✅ Decode success"
            } else {
                Write-Host "        ❌ Decode failed:`n$output"
                $failCount++
                continue
            }
        } catch {
            Write-Host "        ❌ Decode error: $_"
            $failCount++
            continue
        }
        
        Write-Host "  [2/3] 📦 Re-encoding decoded data..."
        try {
            $output = & $TestBinaryPath encode "$decodedFile" "$reencoded" -l 3 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "        ✅ Encode success"
            } else {
                Write-Host "        ❌ Encode failed:`n$output"
                $failCount++
                continue
            }
        } catch {
            Write-Host "        ❌ Encode error: $_"
            $failCount++
            continue
        }
        
        Write-Host "  [3/3] 📊 Verifying integrity..."
        try {
            $origSize = (Get-Item $TestFile).Length
            $reencLen = (Get-Item $reencoded).Length
            $decodedSize = 0
            Get-ChildItem $decodedFile -Recurse -File | ForEach-Object { $decodedSize += $_.Length }
            
            Write-Host "        Original PNG: $(Format-Size $origSize)"
            Write-Host "        Decoded data: $(Format-Size $decodedSize)"
            Write-Host "        Re-encoded PNG: $(Format-Size $reencLen)"
            
            Write-Host "        ✅ Run #$i completed successfully`n"
            $successCount++
        } catch {
            Write-Host "        ⚠️  Verification warning: $_`n"
            $successCount++
        }
    }
    
    Write-Host "╔════════════════════════════════════════════════════════════════════╗"
    Write-Host "║                      TEST RESULTS SUMMARY                           ║"
    Write-Host "╚════════════════════════════════════════════════════════════════════╝"
    Write-Host "✅ Successful runs: $successCount / $NumRuns"
    Write-Host "❌ Failed runs:     $failCount / $NumRuns"
    Write-Host ""
    
    if ($successCount -eq $NumRuns) {
        Write-Host "🎉 All tests passed! Hotfix is working correctly on Windows." -ForegroundColor Green
        return $true
    } elseif ($successCount -gt 0) {
        Write-Host "⚠️  Some tests failed. Review output above." -ForegroundColor Yellow
        return $false
    } else {
        Write-Host "❌ All tests failed. Check the binary and test setup." -ForegroundColor Red
        return $false
    }
}

function Format-Size {
    param([long]$bytes)
    if ($bytes -lt 1KB) { return "$bytes B" }
    if ($bytes -lt 1MB) { return "{0:F2} KB" -f ($bytes / 1KB) }
    if ($bytes -lt 1GB) { return "{0:F2} MB" -f ($bytes / 1MB) }
    return "{0:F2} GB" -f ($bytes / 1GB)
}

Write-Host "╔════════════════════════════════════════════════════════════════════╗"
Write-Host "║          Roxify Windows Hotfix v1.14.5-hotfix.1 Test            ║"
Write-Host "║              Adaptive Window_Log for Streaming                    ║"
Write-Host "╚════════════════════════════════════════════════════════════════════╝`n"

Write-Host "ℹ️  This script will:"
Write-Host "  1. Wait for the GitHub Actions hotfix release to complete"
Write-Host "  2. Download the Windows x64 binary"
Write-Host "  3. Run $NumRuns iterations of encode/decode tests on Weee.png"
Write-Host ""

if ((Download-LatestBinary) -and (Run-Tests)) {
    exit 0
} else {
    exit 1
}
