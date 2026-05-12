# Roxify Compression Levels Benchmark
# Dataset réel: D:\C\Users\Yohan\Desktop\Projets (6628 fichiers, 0.54 GB)

$exe = ".\target\release\roxify_native.exe"
$source = "D:\C\Users\Yohan\Desktop\Projets"
$outputDir = "D:\C\Users\Yohan\Desktop\RoxifyBenchmark"

Write-Host "=== Roxify Compression Benchmark - Dataset Réel ===" -ForegroundColor Cyan
Write-Host "Source: $source"
Write-Host "Output: $outputDir"

# Analyse du dataset
$files = Get-ChildItem $source -Recurse -File
$totalSize = ($files | Measure-Object -Property Length -Sum).Sum
$totalGB = [math]::Round($totalSize / 1GB, 2)
Write-Host "Dataset: $($files.Count) fichiers, $totalGB GB" -ForegroundColor Green

# Vérification de l'exécutable
if (-not (Test-Path $exe)) {
    Write-Host "Construction de roxify..." -ForegroundColor Yellow
    cargo build --release
}

# Création du répertoire de sortie
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Niveaux de compression à tester
$levels = @(1, 3, 7, 11, 15, 19)
$results = @()

Write-Host "`n=== Tests de Compression ===" -ForegroundColor Cyan

foreach ($level in $levels) {
    Write-Host "`n--- Niveau $level ---" -ForegroundColor Yellow
    
    $png = "$outputDir\level$level.png"
    $extractDir = "$outputDir\extracted_level$level"
    
    # Nettoyage
    if (Test-Path $png) { Remove-Item $png -Force }
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    
    # Encodage
    Write-Host "Encodage niveau $level..."
    $startTime = Get-Date
    & $exe encode $source $png --level $level
    $endTime = Get-Date
    $encodeTime = ($endTime - $startTime).TotalSeconds
    
    if (Test-Path $png) {
        $pngSize = (Get-Item $png).Length
        $ratio = [math]::Round(($pngSize / $totalSize) * 100, 2)
        $throughput = [math]::Round($totalSize / $encodeTime / 1MB, 2)
        
        Write-Host "  Temps: $([math]::Round($encodeTime, 2))s" -ForegroundColor Green
        Write-Host "  Taille PNG: $([math]::Round($pngSize / 1MB, 2)) MB" -ForegroundColor Green
        Write-Host "  Ratio: $ratio%" -ForegroundColor Green
        Write-Host "  Débit: $throughput MiB/s" -ForegroundColor Green
        
        # Décodage
        Write-Host "Décodage niveau $level..."
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        $startTime = Get-Date
        & $exe decompress $png $extractDir
        $endTime = Get-Date
        $decodeTime = ($endTime - $startTime).TotalSeconds
        
        $decodeThroughput = [math]::Round($totalSize / $decodeTime / 1MB, 2)
        Write-Host "  Décodage: $([math]::Round($decodeTime, 2))s ($decodeThroughput MiB/s)" -ForegroundColor Blue
        
        # Vérification
        $extractedFiles = Get-ChildItem $extractDir -Recurse -File
        $extractedSize = ($extractedFiles | Measure-Object -Property Length -Sum).Sum
        
        if ($extractedFiles.Count -eq $files.Count -and $extractedSize -eq $totalSize) {
            Write-Host "  ✅ Vérification OK" -ForegroundColor Green
            $status = "SUCCESS"
        } else {
            Write-Host "  ❌ Erreur de vérification" -ForegroundColor Red
            $status = "FAILED"
        }
        
        # Stockage des résultats
        $results += [PSCustomObject]@{
            Level = $level
            EncodeTime = [math]::Round($encodeTime, 3)
            DecodeTime = [math]::Round($decodeTime, 3)
            TotalTime = [math]::Round($encodeTime + $decodeTime, 3)
            OriginalSizeMB = [math]::Round($totalSize / 1MB, 2)
            CompressedSizeMB = [math]::Round($pngSize / 1MB, 2)
            Ratio = $ratio
            EncodeThroughput = $throughput
            DecodeThroughput = $decodeThroughput
            Status = $status
        }
        
        # Nettoyage pour le prochain test
        Remove-Item $extractDir -Recurse -Force
    } else {
        Write-Host "  ❌ Échec de l'encodage" -ForegroundColor Red
        $results += [PSCustomObject]@{
            Level = $level
            EncodeTime = "N/A"
            DecodeTime = "N/A"
            TotalTime = "N/A"
            OriginalSizeMB = [math]::Round($totalSize / 1MB, 2)
            CompressedSizeMB = "N/A"
            Ratio = "N/A"
            EncodeThroughput = "N/A"
            DecodeThroughput = "N/A"
            Status = "FAILED"
        }
    }
}

# Affichage des résultats
Write-Host "`n=== RÉSULTATS COMPLETS ===" -ForegroundColor Cyan
Write-Host "Dataset: $($files.Count) fichiers, $totalGB GB`n" -ForegroundColor Green

# Tableau formaté
Write-Host "Level | Encode(s) | Decode(s) | Total(s) | Size(MB) | Ratio% | Enc(MiB/s) | Dec(MiB/s) | Status"
Write-Host "------|-----------|-----------|----------|----------|--------|------------|------------|--------"

foreach ($result in $results) {
    $statusColor = if ($result.Status -eq "SUCCESS") { "Green" } else { "Red" }
    Write-Host ("{0,-5} | {1,9} | {2,9} | {3,8} | {4,8} | {5,6} | {6,10} | {7,10} | {8}" -f 
        $result.Level,
        $result.EncodeTime,
        $result.DecodeTime,
        $result.TotalTime,
        $result.CompressedSizeMB,
        $result.Ratio,
        $result.EncodeThroughput,
        $result.DecodeThroughput,
        $result.Status
    ) -ForegroundColor $statusColor
}

# Analyse et recommandations
Write-Host "`n=== ANALYSE & RECOMMANDATIONS ===" -ForegroundColor Cyan

$successful = $results | Where-Object { $_.Status -eq "SUCCESS" }
if ($successful.Count -gt 0) {
    # Meilleur ratio
    $bestRatio = $successful | Sort-Object Ratio | Select-Object -First 1
    Write-Host "🏆 Meilleur ratio: Niveau $($bestRatio.Level) ($(bestRatio.Ratio)%)" -ForegroundColor Green
    
    # Encodage le plus rapide
    $fastestEncode = $successful | Sort-Object EncodeTime | Select-Object -First 1
    Write-Host "⚡ Encodage plus rapide: Niveau $($fastestEncode.Level) ($($fastestEncode.EncodeTime)s)" -ForegroundColor Green
    
    # Meilleur équilibre (score pondéré)
    foreach ($result in $successful) {
        # Score: vitesse (40%) + ratio (30%) + débit (30%)
        $speedScore = (100 / $result.EncodeTime) * 0.4
        $ratioScore = ((100 - $result.Ratio) / 100) * 100 * 0.3
        $throughputScore = ($result.EncodeThroughput / 100) * 30
        $result | Add-Member -NotePropertyName "BalanceScore" -NotePropertyValue ($speedScore + $ratioScore + $throughputScore)
    }
    
    $bestBalance = $successful | Sort-Object BalanceScore -Descending | Select-Object -First 1
    Write-Host "⚖️  Meilleur équilibre vitesse/ratio: Niveau $($bestBalance.Level)" -ForegroundColor Yellow
    
    Write-Host "`n💡 Recommandation pour usage quotidien: Niveau $($bestBalance.Level)" -ForegroundColor Cyan
    Write-Host "   - Bon équilibre vitesse/compression" -ForegroundColor Gray
    Write-Host "   - Adapté aux petits et moyens fichiers" -ForegroundColor Gray
    Write-Host "   - Temps total: $($bestBalance.TotalTime)s" -ForegroundColor Gray
}

Write-Host "`n=== Benchmark terminé ===" -ForegroundColor Green
