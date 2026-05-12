# Roxify Small Files Benchmark
# Test sur petits fichiers pour trouver l'équilibre parfait vitesse/ratio

$exe = ".\target\release\roxify_native.exe"
$testDir = "D:\C\Users\Yohan\Desktop\SmallFilesTest"
$outputDir = "D:\C\Users\Yohan\Desktop\SmallFilesBenchmark"

Write-Host "=== Roxify Small Files Benchmark ===" -ForegroundColor Cyan

# Création du dataset de petits fichiers
Write-Host "Création du dataset de test..." -ForegroundColor Yellow

New-Item -ItemType Directory -Force -Path $testDir | Out-Null
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Nettoyage précédent
Remove-Item "$testDir\*" -Recurse -Force -ErrorAction SilentlyContinue

# Création de différents types de petits fichiers
Write-Host "Génération des fichiers de test..." -ForegroundColor Yellow

# Fichiers texte très petits (1-10KB)
for ($i = 1; $i -le 20; $i++) {
    $content = "Test file $i - " + ("lorem ipsum " * (Get-Random -Minimum 10 -Maximum 100))
    $size = Get-Random -Minimum 1024 -Maximum 10240
    $content = $content.Substring(0, [Math]::Min($content.Length, $size))
    Set-Content "$testDir\small_text_$i.txt" $content
}

# Fichiers JSON petits (2-15KB)
for ($i = 1; $i -le 15; $i++) {
    $json = @{
        id = $i
        name = "test_item_$i"
        data = @(1..(Get-Random -Minimum 5 -Maximum 20))
        metadata = @{
            created = (Get-Date).ToString()
            tags = @("test", "benchmark", "small")
        }
    } | ConvertTo-Json -Depth 3
    Set-Content "$testDir\small_json_$i.json" $json
}

# Fichiers binaires petits (512B-5KB)
for ($i = 1; $i -le 10; $i++) {
    $bytes = [byte[]]::new((Get-Random -Minimum 512 -Maximum 5120))
    $random = New-Object System.Random
    $random.NextBytes($bytes)
    [System.IO.File]::WriteAllBytes("$testDir\small_binary_$i.bin", $bytes)
}

# Quelques fichiers de code
$codeSamples = @(
    "function test() { console.log('Hello World'); return true; }",
    "def fibonacci(n): return n if n <= 1 else fibonacci(n-1) + fibonacci(n-2)",
    "public class Test { public static void Main() { System.Console.WriteLine('Test'); } }",
    "SELECT * FROM users WHERE active = 1 ORDER BY created_at DESC;",
    "import React from 'react'; export default function App() { return <div>Hello</div>; }"
)

for ($i = 0; $i -lt $codeSamples.Count; $i++) {
    $extensions = @("js", "py", "cs", "sql", "jsx")
    Set-Content "$testDir\code_$i.$($extensions[$i])" $codeSamples[$i]
}

# Analyse du dataset
$files = Get-ChildItem $testDir -Recurse -File
$totalSize = ($files | Measure-Object -Property Length -Sum).Sum
$totalKB = [math]::Round($totalSize / 1KB, 2)

Write-Host "Dataset créé: $($files.Count) fichiers, $totalKB KB" -ForegroundColor Green

# Vérification de l'exécutable
if (-not (Test-Path $exe)) {
    Write-Host "Construction de roxify..." -ForegroundColor Yellow
    cargo build --release
}

# Niveaux de compression optimisés pour petits fichiers
$levels = @(1, 3, 5, 7, 9)
$results = @()

Write-Host "`n=== Tests de Compression sur Petits Fichiers ===" -ForegroundColor Cyan

foreach ($level in $levels) {
    Write-Host "`n--- Niveau $level ---" -ForegroundColor Yellow
    
    $png = "$outputDir\small_level$level.png"
    $extractDir = "$outputDir\extracted_small_$level"
    
    # Nettoyage
    if (Test-Path $png) { Remove-Item $png -Force }
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    
    # Encodage
    Write-Host "Encodage niveau $level..."
    $startTime = Get-Date
    & $exe encode $testDir $png --level $level
    $endTime = Get-Date
    $encodeTime = ($endTime - $startTime).TotalSeconds
    
    if (Test-Path $png) {
        $pngSize = (Get-Item $png).Length
        $ratio = [math]::Round(($pngSize / $totalSize) * 100, 2)
        $overheadKB = [math]::Round(($pngSize - $totalSize) / 1KB, 2)
        
        Write-Host "  Temps: $([math]::Round($encodeTime, 3))s" -ForegroundColor Green
        Write-Host "  Taille PNG: $([math]::Round($pngSize / 1KB, 2)) KB" -ForegroundColor Green
        Write-Host "  Ratio: $ratio%" -ForegroundColor Green
        Write-Host "  Overhead: $overheadKB KB" -ForegroundColor Yellow
        
        # Décodage
        Write-Host "Décodage niveau $level..."
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        $startTime = Get-Date
        & $exe decompress $png $extractDir
        $endTime = Get-Date
        $decodeTime = ($endTime - $startTime).TotalSeconds
        
        Write-Host "  Décodage: $([math]::Round($decodeTime, 3))s" -ForegroundColor Blue
        
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
        
        # Score d'équilibre (vitesse + ratio)
        $speedScore = 100 / $encodeTime  # Plus c'est rapide, meilleur est le score
        $compressionScore = (100 - $ratio)  # Moins de ratio = meilleur
        $balanceScore = ($speedScore * 0.6) + ($compressionScore * 0.4)  # 60% vitesse, 40% compression
        
        # Stockage des résultats
        $results += [PSCustomObject]@{
            Level = $level
            EncodeTime = [math]::Round($encodeTime, 3)
            DecodeTime = [math]::Round($decodeTime, 3)
            TotalTime = [math]::Round($encodeTime + $decodeTime, 3)
            OriginalSizeKB = $totalKB
            CompressedSizeKB = [math]::Round($pngSize / 1KB, 2)
            Ratio = $ratio
            OverheadKB = $overheadKB
            SpeedScore = [math]::Round($speedScore, 1)
            CompressionScore = [math]::Round($compressionScore, 1)
            BalanceScore = [math]::Round($balanceScore, 1)
            Status = $status
        }
        
        # Nettoyage
        Remove-Item $extractDir -Recurse -Force
    } else {
        Write-Host "  ❌ Échec de l'encodage" -ForegroundColor Red
        $results += [PSCustomObject]@{
            Level = $level
            EncodeTime = "N/A"
            DecodeTime = "N/A"
            TotalTime = "N/A"
            OriginalSizeKB = $totalKB
            CompressedSizeKB = "N/A"
            Ratio = "N/A"
            OverheadKB = "N/A"
            SpeedScore = "N/A"
            CompressionScore = "N/A"
            BalanceScore = "N/A"
            Status = "FAILED"
        }
    }
}

# Affichage des résultats
Write-Host "`n=== RÉSULTATS PETITS FICHIERS ===" -ForegroundColor Cyan
Write-Host "Dataset: $($files.Count) fichiers, $totalKB KB`n" -ForegroundColor Green

Write-Host "Level | Encode(s) | Decode(s) | Total(s) | Size(KB) | Ratio% | Overhead | Speed | Comp | Balance | Status"
Write-Host "------|-----------|-----------|----------|----------|--------|----------|-------|------|---------|--------"

foreach ($result in $results) {
    $statusColor = if ($result.Status -eq "SUCCESS") { "Green" } else { "Red" }
    Write-Host ("{0,-5} | {1,9} | {2,9} | {3,8} | {4,8} | {5,6} | {6,8} | {7,5} | {8,4} | {9,7} | {10}" -f 
        $result.Level,
        $result.EncodeTime,
        $result.DecodeTime,
        $result.TotalTime,
        $result.CompressedSizeKB,
        $result.Ratio,
        $result.OverheadKB,
        $result.SpeedScore,
        $result.CompressionScore,
        $result.BalanceScore,
        $result.Status
    ) -ForegroundColor $statusColor
}

# Analyse et recommandations
Write-Host "`n=== ANALYSE PETITS FICHIERS ===" -ForegroundColor Cyan

$successful = $results | Where-Object { $_.Status -eq "SUCCESS" }
if ($successful.Count -gt 0) {
    # Meilleur équilibre
    $bestBalance = $successful | Sort-Object BalanceScore -Descending | Select-Object -First 1
    Write-Host "🏆 Meilleur équilibre vitesse/ratio: Niveau $($bestBalance.Level)" -ForegroundColor Green
    Write-Host "   Score: $($bestBalance.BalanceScore) | Temps: $($bestBalance.EncodeTime)s | Ratio: $($bestBalance.Ratio)%" -ForegroundColor Gray
    
    # Plus rapide
    $fastest = $successful | Sort-Object EncodeTime | Select-Object -First 1
    Write-Host "⚡ Plus rapide: Niveau $($fastest.Level) ($($fastest.EncodeTime)s)" -ForegroundColor Yellow
    
    # Meilleure compression
    $bestCompression = $successful | Sort-Object Ratio | Select-Object -First 1
    Write-Host "📦 Meilleure compression: Niveau $($bestCompression.Level) ($($bestCompression.Ratio)%)" -ForegroundColor Cyan
    
    Write-Host "`n💡 Recommandation pour petits fichiers:" -ForegroundColor Green
    Write-Host "   → Niveau $($bestBalance.Level) pour usage quotidien" -ForegroundColor White
    Write-Host "   → Niveau $($fastest.Level) pour vitesse maximale" -ForegroundColor White
    Write-Host "   → Niveau $($bestCompression.Level) pour stockage optimal" -ForegroundColor White
}

Write-Host "`n=== Benchmark terminé ===" -ForegroundColor Green

# Nettoyage
Remove-Item $testDir -Recurse -Force -ErrorAction SilentlyContinue
