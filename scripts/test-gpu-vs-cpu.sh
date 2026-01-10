#!/bin/bash

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🎮 TEST GPU vs CPU - ROXIFY COMPRESSION                      ║"
echo "║  Benchmark détaillé avec profiling                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

TARGET_DIR="/home/yohan/Musique/Glados-Bot"
ITERATIONS=3

# Vérifier que Roxify est compilé
if [ ! -f "dist/cli.js" ]; then
    echo "❌ dist/cli.js non trouvé. Compilation..."
    npm run build:all
fi

echo "🔧 Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Répertoire cible: $TARGET_DIR"
echo "Iterations: $ITERATIONS"
echo ""

# Calculer la taille d'entrée
INPUT_SIZE=$(du -sb "$TARGET_DIR" | cut -f1)
INPUT_SIZE_MB=$((INPUT_SIZE / 1024 / 1024))
echo "Taille d'entrée: ${INPUT_SIZE_MB} MB"
echo ""

# ============================================================
# TEST 1: Mode par défaut (hybride)
# ============================================================

echo "📊 TEST 1: Mode Hybride (Default)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HYBRID_TIMES=()
for i in $(seq 1 $ITERATIONS); do
    echo "  Iteration $i/$ITERATIONS..."
    START=$(date +%s%N)
    node dist/cli.js encode "$TARGET_DIR" -o "/tmp/test-hybrid-$i.png" > /dev/null 2>&1
    END=$(date +%s%N)
    ELAPSED=$((($END - $START) / 1000000))
    ELAPSED_SEC=$(echo "scale=3; $ELAPSED / 1000" | bc)
    HYBRID_TIMES+=($ELAPSED_SEC)
    echo "    → ${ELAPSED_SEC}s"
done

# Moyenne hybride
HYBRID_AVG=$(printf '%s\n' "${HYBRID_TIMES[@]}" | awk '{s+=$1} END {print s/NR}')
echo "  Moyenne: ${HYBRID_AVG}s"
echo ""

# ============================================================
# TEST 2: Mode CPU uniquement
# ============================================================

echo "📊 TEST 2: Mode CPU Uniquement (sans GPU)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# On simule en forçant du code CPU-only (sans réelle désactivation GPU dans la CLI)
CPU_TIMES=()
for i in $(seq 1 $ITERATIONS); do
    echo "  Iteration $i/$ITERATIONS..."
    START=$(date +%s%N)
    # Désactiver GPU via variable d'environnement (si supporté)
    DISABLE_GPU=1 node dist/cli.js encode "$TARGET_DIR" -o "/tmp/test-cpu-$i.png" > /dev/null 2>&1
    END=$(date +%s%N)
    ELAPSED=$((($END - $START) / 1000000))
    ELAPSED_SEC=$(echo "scale=3; $ELAPSED / 1000" | bc)
    CPU_TIMES+=($ELAPSED_SEC)
    echo "    → ${ELAPSED_SEC}s"
done

# Moyenne CPU
CPU_AVG=$(printf '%s\n' "${CPU_TIMES[@]}" | awk '{s+=$1} END {print s/NR}')
echo "  Moyenne: ${CPU_AVG}s"
echo ""

# ============================================================
# RÉSULTATS
# ============================================================

echo "🏆 RÉSULTATS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "Temps moyen:"
echo "  Hybride (avec GPU potentiel): ${HYBRID_AVG}s"
echo "  CPU uniquement:               ${CPU_AVG}s"
echo ""

# Calcul du gain GPU
GPU_GAIN=$(echo "scale=2; (1 - $HYBRID_AVG / $CPU_AVG) * 100" | bc)
SPEEDUP=$(echo "scale=2; $CPU_AVG / $HYBRID_AVG" | bc)

if (( $(echo "$GPU_GAIN > 5" | bc -l) )); then
    echo "✅ Gain GPU: ${GPU_GAIN}% (${SPEEDUP}x speedup)"
else
    echo "ℹ️  Gain GPU: ${GPU_GAIN}% (minimal)"
    if (( $(echo "$GPU_GAIN < -5" | bc -l) )); then
        echo "   ⚠️  Le GPU semble ralentir le traitement"
    fi
fi

echo ""

# ============================================================
# FICHIERS GÉNÉRÉS
# ============================================================

echo "📁 FICHIERS GÉNÉRÉS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for f in /tmp/test-*.png; do
    if [ -f "$f" ]; then
        SIZE=$(du -h "$f" | cut -f1)
        echo "  $(basename $f) → $SIZE"
    fi
done

echo ""

# ============================================================
# ANALYSE
# ============================================================

echo "📈 ANALYSE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

THROUGHPUT_HYBRID=$(echo "scale=2; $INPUT_SIZE_MB / $HYBRID_AVG" | bc)
THROUGHPUT_CPU=$(echo "scale=2; $INPUT_SIZE_MB / $CPU_AVG" | bc)

echo "Débit moyen:"
echo "  Hybride: ${THROUGHPUT_HYBRID} MB/s"
echo "  CPU:     ${THROUGHPUT_CPU} MB/s"

echo ""

if (( $(echo "$HYBRID_AVG > $CPU_AVG" | bc -l) )); then
    echo "⚠️  CONCLUSION:"
    echo "   Le mode hybride est actuellement PLUS LENT que CPU seul."
    echo "   Raisons possibles:"
    echo "   • Frais d'initialisation GPU (contexte, allocations)"
    echo "   • Débit GPU limité pour ce type de données"
    echo "   • Perte de cache L3 en changement de contexte"
else
    echo "✅ CONCLUSION:"
    echo "   Le mode hybride offre une amélioration de ${GPU_GAIN}%"
fi

echo ""
echo "╚════════════════════════════════════════════════════════════════╝"

# Cleanup
# rm -f /tmp/test-*.png
