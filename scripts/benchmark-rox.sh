#!/bin/bash

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  BENCHMARK COMPRESSION HYBRIDE CPU/GPU - Glados-Bot       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

TARGET_DIR="/home/yohan/Musique/Glados-Bot"
OUTPUT_GPU="/tmp/glados-gpu.png"
OUTPUT_CPU="/tmp/glados-cpu.png"

# Vérifier que le répertoire existe
if [ ! -d "$TARGET_DIR" ]; then
    echo "❌ Erreur: Répertoire $TARGET_DIR non trouvé"
    exit 1
fi

# Calculer la taille totale
TOTAL_SIZE=$(du -sb "$TARGET_DIR" | cut -f1)
TOTAL_SIZE_MB=$((TOTAL_SIZE / 1024 / 1024))

echo "📊 Cible: $TARGET_DIR"
echo "📦 Taille totale: $TOTAL_SIZE_MB MB ($TOTAL_SIZE bytes)"
echo ""

# Test 1: Avec GPU (par défaut)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎮 TEST 1: AVEC GPU (si disponible)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

START_TIME=$(date +%s%N)
OUTPUT_GPU=$(node dist/cli.js encode "$TARGET_DIR" -o "/tmp/glados-gpu.png" 2>&1)
END_TIME=$(date +%s%N)

ELAPSED_GPU=$(( (END_TIME - START_TIME) / 1000000 ))  # en millisecondes
ELAPSED_GPU_SEC=$(echo "scale=3; $ELAPSED_GPU / 1000" | bc)

echo "$OUTPUT_GPU"
echo ""

# Obtenir la taille du fichier compressé
if [ -f "/tmp/glados-gpu.png" ]; then
    COMPRESSED_GPU=$(du -b "/tmp/glados-gpu.png" | cut -f1)
    COMPRESSED_GPU_MB=$((COMPRESSED_GPU / 1024 / 1024))
    RATIO_GPU=$(echo "scale=2; $COMPRESSED_GPU * 100 / $TOTAL_SIZE" | bc)
    echo "📦 Fichier compressé: /tmp/glados-gpu.png"
    echo "📊 Taille: $COMPRESSED_GPU_MB MB ($COMPRESSED_GPU bytes)"
    echo "📈 Ratio: ${RATIO_GPU}%"
else
    COMPRESSED_GPU_MB="N/A"
    RATIO_GPU="N/A"
fi

echo "⏱️  Temps total (GPU): ${ELAPSED_GPU_SEC}s"
echo ""

THROUGHPUT_GPU="N/A"
if [ ! -z "$ELAPSED_GPU_SEC" ] && [ "$ELAPSED_GPU_SEC" != "0" ]; then
    THROUGHPUT_GPU=$(echo "scale=2; $TOTAL_SIZE_MB / $ELAPSED_GPU_SEC" | bc)
fi

# Test 2: Désactiver GPU (CPU only)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🖥️  TEST 2: CPU ONLY (sans GPU)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

START_TIME=$(date +%s%N)
OUTPUT_CPU=$(node dist/cli.js encode "$TARGET_DIR" -o "/tmp/glados-cpu.png" --no-compress 2>&1)
END_TIME=$(date +%s%N)

ELAPSED_CPU=$(( (END_TIME - START_TIME) / 1000000 ))  # en millisecondes
ELAPSED_CPU_SEC=$(echo "scale=3; $ELAPSED_CPU / 1000" | bc)

echo "$OUTPUT_CPU"
echo ""

# Obtenir la taille du fichier non compressé
if [ -f "/tmp/glados-cpu.png" ]; then
    COMPRESSED_CPU=$(du -b "/tmp/glados-cpu.png" | cut -f1)
    COMPRESSED_CPU_MB=$((COMPRESSED_CPU / 1024 / 1024))
    RATIO_CPU=$(echo "scale=2; $COMPRESSED_CPU * 100 / $TOTAL_SIZE" | bc)
    echo "📦 Fichier (sans compression): /tmp/glados-cpu.png"
    echo "📊 Taille: $COMPRESSED_CPU_MB MB ($COMPRESSED_CPU bytes)"
    echo "📈 Ratio: ${RATIO_CPU}%"
else
    COMPRESSED_CPU_MB="N/A"
    RATIO_CPU="N/A"
fi

echo "⏱️  Temps total (CPU/no-compress): ${ELAPSED_CPU_SEC}s"
echo ""

THROUGHPUT_CPU="N/A"
if [ ! -z "$ELAPSED_CPU_SEC" ] && [ "$ELAPSED_CPU_SEC" != "0" ]; then
    THROUGHPUT_CPU=$(echo "scale=2; $TOTAL_SIZE_MB / $ELAPSED_CPU_SEC" | bc)
fi

# Résumé et comparaison
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              📊 RÉSUMÉ DES BENCHMARKS                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

echo "📦 Données d'entrée:"
echo "   Répertoire: $TARGET_DIR"
echo "   Taille originale: $TOTAL_SIZE_MB MB"
echo ""

echo "🎮 Avec compression (GPU):"
echo "   Temps: ${ELAPSED_GPU_SEC}s"
echo "   Débit: ${THROUGHPUT_GPU} MB/s"
if [ "$COMPRESSED_GPU_MB" != "N/A" ]; then
    echo "   Taille compressée: $COMPRESSED_GPU_MB MB"
    echo "   Ratio: ${RATIO_GPU}%"
fi
echo ""

echo "🖥️  Sans compression (CPU baseline):"
echo "   Temps: ${ELAPSED_CPU_SEC}s"
echo "   Débit: ${THROUGHPUT_CPU} MB/s"
if [ "$COMPRESSED_CPU_MB" != "N/A" ]; then
    echo "   Taille: $COMPRESSED_CPU_MB MB"
    echo "   Ratio: ${RATIO_CPU}%"
fi
echo ""

# Comparaison
if [ "$ELAPSED_GPU_SEC" != "0" ] && [ "$ELAPSED_CPU_SEC" != "0" ]; then
    SPEEDUP=$(echo "scale=2; $ELAPSED_CPU_SEC / $ELAPSED_GPU_SEC" | bc)
    echo "⚡ Comparaison Temps:"
    echo "   Ratio: ${SPEEDUP}x"
    if (( $(echo "$SPEEDUP > 1" | bc -l) )); then
        PERC=$(echo "scale=0; ($SPEEDUP - 1) * 100" | bc)
        echo "   ✅ Avec compression est ${PERC}% plus rapide"
    elif (( $(echo "$SPEEDUP < 1" | bc -l) )); then
        PERC=$(echo "scale=0; (1 - $SPEEDUP) * 100" | bc)
        echo "   ⚠️  Sans compression est ${PERC}% plus rapide"
    else
        echo "   ≈ Performance similaire"
    fi
fi

if [ "$COMPRESSED_GPU_MB" != "N/A" ] && [ "$COMPRESSED_CPU_MB" != "N/A" ]; then
    COMPRESSION_GAIN=$(echo "scale=1; ($COMPRESSED_CPU_MB - $COMPRESSED_GPU_MB) / $COMPRESSED_CPU_MB * 100" | bc)
    echo ""
    echo "📉 Économies:"
    echo "   Taille réduite de: ${COMPRESSION_GAIN}%"
    SAVED=$((COMPRESSED_CPU_MB - COMPRESSED_GPU_MB))
    echo "   Octets économisés: $SAVED MB"
fi

echo ""
echo "╚════════════════════════════════════════════════════════════╝"

# Afficher détails fichiers
echo ""
echo "📁 Fichiers générés:"
if [ -f "/tmp/glados-gpu.png" ]; then
    echo "   ✅ /tmp/glados-gpu.png ($(du -h /tmp/glados-gpu.png | cut -f1))"
fi
if [ -f "/tmp/glados-cpu.png" ]; then
    echo "   ✅ /tmp/glados-cpu.png ($(du -h /tmp/glados-cpu.png | cut -f1))"
fi
echo ""
