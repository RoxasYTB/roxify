# Performance Validation Script
$exe = ".\target\release\roxify_native.exe"
$png = "D:\C\Users\Yohan\Desktop\Direct_Test.png"

Write-Host "=== Roxify Performance Validation ==="
Write-Host "Testing extraction performance consistency..."

# Test 1: Warm up
Write-Host "Test 1: Warm up run"
$startTime = Get-Date
& $exe decompress $png "D:\C\Users\Yohan\Desktop\Warmup_Test"
$endTime = Get-Date
$warmupTime = ($endTime - $startTime).TotalSeconds
$warmupFiles = (Get-ChildItem "D:\C\Users\Yohan\Desktop\Warmup_Test" -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
Remove-Item "D:\C\Users\Yohan\Desktop\Warmup_Test" -Force -Recurse -ErrorAction SilentlyContinue
Write-Host "Warmup: $warmupTime seconds, Files: $warmupFiles"

# Test 2-4: Cold runs for consistency
for ($run = 2; $run -le 4; $run++) {
    Write-Host "`nTest $run: Cold extraction"
    $startTime = Get-Date
    $outputDir = "D:\C\Users\Yohan\Desktop\Cold_Test_$run"
    
    & $exe decompress $png $outputDir
    $endTime = Get-Date
    $duration = ($endTime - $startTime).TotalSeconds
    
    $files = (Get-ChildItem $outputDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Host "Time: $duration seconds, Files: $files"
    
    # Clean up for next run
    Remove-Item $outputDir -Force -Recurse -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Write-Host "`n=== Performance Validation Complete ==="
Write-Host "Expected: ~4.1 seconds for 13,314 files"
Write-Host "If results are consistent, the 4.1s performance is legitimate"
