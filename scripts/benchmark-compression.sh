#!/bin/bash

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  BENCHMARK COMPRESSION HYBRIDE CPU/GPU - Glados-Bot       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

TARGET_DIR="/home/yohan/Musique/Glados-Bot"
RESULTS_FILE="/tmp/compression_benchmark.json"

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
OUTPUT_GPU=$(node dist/cli.js "$TARGET_DIR" 2>&1)
END_TIME=$(date +%s%N)

ELAPSED_GPU=$(( (END_TIME - START_TIME) / 1000000 ))  # en millisecondes
ELAPSED_GPU_SEC=$(echo "scale=3; $ELAPSED_GPU / 1000" | bc)

echo "$OUTPUT_GPU"
echo ""
echo "⏱️  Temps total (GPU): ${ELAPSED_GPU_SEC}s"
echo ""

# Extraire la taille compressée si possible
if echo "$OUTPUT_GPU" | grep -q "compression"; then
    COMPRESSED_GPU=$(echo "$OUTPUT_GPU" | grep -oP "Compressed.*?:\s*\K[0-9]+" | head -1)
else
    COMPRESSED_GPU="N/A"
fi

THROUGHPUT_GPU="N/A"
if [ ! -z "$ELAPSED_GPU_SEC" ] && [ "$ELAPSED_GPU_SEC" != "0" ]; then
    THROUGHPUT_GPU=$(echo "scale=2; $TOTAL_SIZE_MB / $ELAPSED_GPU_SEC" | bc)
fi

# Test 2: Désactiver GPU (CPU only) - Via variable d'environnement
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🖥️  TEST 2: CPU ONLY (sans GPU)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

START_TIME=$(date +%s%N)
# Essayer de désactiver GPU via variable d'environnement
OUTPUT_CPU=$(ROXIFY_DISABLE_GPU=1 node dist/cli.js "$TARGET_DIR" 2>&1)
END_TIME=$(date +%s%N)

ELAPSED_CPU=$(( (END_TIME - START_TIME) / 1000000 ))  # en millisecondes
ELAPSED_CPU_SEC=$(echo "scale=3; $ELAPSED_CPU / 1000" | bc)

echo "$OUTPUT_CPU"
echo ""
echo "⏱️  Temps total (CPU): ${ELAPSED_CPU_SEC}s"
echo ""

COMPRESSED_CPU="N/A"
if echo "$OUTPUT_CPU" | grep -q "compression"; then
    COMPRESSED_CPU=$(echo "$OUTPUT_CPU" | grep -oP "Compressed.*?:\s*\K[0-9]+" | head -1)
fi

THROUGHPUT_CPU="N/A"
if [ ! -z "$ELAPSED_CPU_SEC" ] && [ "$ELAPSED_CPU_SEC" != "0" ]; then
    THROUGHPUT_CPU=$(echo "scale=2; $TOTAL_SIZE_MB / $ELAPSED_CPU_SEC" | bc)
fi

# Résumé et comparaison
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              📊 RÉSUMÉ DES BENCHMARKS                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

echo "📦 Données:"
echo "   Répertoire: $TARGET_DIR"
echo "   Taille originale: $TOTAL_SIZE_MB MB"
echo ""

echo "🎮 Avec GPU:"
echo "   Temps: ${ELAPSED_GPU_SEC}s"
echo "   Débit: ${THROUGHPUT_GPU} MB/s"
if [ "$COMPRESSED_GPU" != "N/A" ]; then
    RATIO_GPU=$(echo "scale=1; $COMPRESSED_GPU * 100 / $TOTAL_SIZE_MB" | bc)
    echo "   Taille compressée: $COMPRESSED_GPU MB (${RATIO_GPU}%)"
fi
echo ""

echo "🖥️  CPU Only:"
echo "   Temps: ${ELAPSED_CPU_SEC}s"
echo "   Débit: ${THROUGHPUT_CPU} MB/s"
if [ "$COMPRESSED_CPU" != "N/A" ]; then
    RATIO_CPU=$(echo "scale=1; $COMPRESSED_CPU * 100 / $TOTAL_SIZE_MB" | bc)
    echo "   Taille compressée: $COMPRESSED_CPU MB (${RATIO_CPU}%)"
fi
echo ""

# Comparaison
if [ "$ELAPSED_GPU_SEC" != "0" ] && [ "$ELAPSED_CPU_SEC" != "0" ]; then
    SPEEDUP=$(echo "scale=2; $ELAPSED_CPU_SEC / $ELAPSED_GPU_SEC" | bc)
    echo "⚡ Accélération GPU: ${SPEEDUP}x"
    if (( $(echo "$SPEEDUP > 1" | bc -l) )); then
        echo "   ✅ GPU est $(echo "scale=0; ($SPEEDUP - 1) * 100" | bc)% plus rapide"
    elif (( $(echo "$SPEEDUP < 1" | bc -l) )); then
        echo "   ⚠️  CPU est $(echo "scale=0; (1 - $SPEEDUP) * 100" | bc)% plus rapide"
    else
        echo "   ≈ Performance similaire"
    fi
fi

echo ""
echo "╚════════════════════════════════════════════════════════════╝"

# Sauvegarder résultats en JSON
cat > "$RESULTS_FILE" << JSON_EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "target_dir": "$TARGET_DIR",
  "original_size_mb": $TOTAL_SIZE_MB,
  "original_size_bytes": $TOTAL_SIZE,
  "gpu": {
    "time_seconds": $ELAPSED_GPU_SEC,
    "throughput_mbps": "$THROUGHPUT_GPU",
    "compressed_size_mb": "$COMPRESSED_GPU"
  },
  "cpu": {
    "time_seconds": $ELAPSED_CPU_SEC,
    "throughput_mbps": "$THROUGHPUT_CPU",
    "compressed_size_mb": "$COMPRESSED_CPU"
  }
}
JSON_EOF

echo "💾 Résultats sauvegardés dans: $RESULTS_FILE"
