# Roxify Simple Benchmark - Dataset Réel
$exe = ".\target\release\roxify_native.exe"
$source = "D:\C\Users\Yohan\Desktop\Projets"
$outputDir = "D:\C\Users\Yohan\Desktop\RoxifySimpleBenchmark"

Write-Host "=== Roxify Simple Benchmark ===" -ForegroundColor Cyan

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

# Test des niveaux les plus importants
$levels = @(1, 3, 7, 15)
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
        Write-Host "  Taille: $([math]::Round($pngSize / 1MB, 2)) MB" -ForegroundColor Green
        Write-Host "  Ratio: $ratio%" -ForegroundColor Green
        Write-Host "  Débit: $throughput MiB/s" -ForegroundColor Green
        
        # Décodage
        Write-Host "Décodage..."
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        $startTime = Get-Date
        & $exe decompress $png $extractDir
        $endTime = Get-Date
        $decodeTime = ($endTime - $startTime).TotalSeconds
        
        Write-Host "  Décodage: $([math]::Round($decodeTime, 2))s" -ForegroundColor Blue
        
        # Stockage des résultats
        $results += [PSCustomObject]@{
            Level = $level
            EncodeTime = [math]::Round($encodeTime, 2)
            DecodeTime = [math]::Round($decodeTime, 2)
            TotalTime = [math]::Round($encodeTime + $decodeTime, 2)
            SizeMB = [math]::Round($pngSize / 1MB, 2)
            Ratio = $ratio
            Throughput = $throughput
        }
        
        # Nettoyage
        Remove-Item $extractDir -Recurse -Force
    }
}

# Résultats
Write-Host "`n=== RÉSULTATS ===" -ForegroundColor Cyan
Write-Host "Level | Encode(s) | Decode(s) | Total(s) | Size(MB) | Ratio% | Throughput"
Write-Host "------|-----------|-----------|----------|----------|--------|----------"

foreach ($result in $results) {
    Write-Host ("{0,-5} | {1,9} | {2,9} | {3,8} | {4,8} | {5,6} | {6,8}" -f 
        $result.Level, $result.EncodeTime, $result.DecodeTime, 
        $result.TotalTime, $result.SizeMB, $result.Ratio, $result.Throughput)
}

# Recommandation
$bestBalance = $results | Sort-Object { $_.EncodeTime + $_.Ratio } | Select-Object -First 1
Write-Host "`n💡 Recommandation: Niveau $($bestBalance.Level)" -ForegroundColor Green
Write-Host "   Bon équilibre vitesse/compression pour usage quotidien" -ForegroundColor Gray

Write-Host "`nBenchmark terminé" -ForegroundColor Green
