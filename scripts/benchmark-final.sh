#!/bin/bash

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  BENCHMARK ROXIFY - COMPRESSION GLADOS-BOT                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

TARGET_DIR="/home/yohan/Musique/Glados-Bot"
OUTPUT_COMPRESSED="/tmp/glados-compressed.png"
OUTPUT_UNCOMPRESSED="/tmp/glados-uncompressed.png"

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

# Test 1: Avec compression
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 TEST 1: AVEC COMPRESSION (Zstd par défaut)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

START_TIME=$(date +%s%N)
OUTPUT1=$(node dist/cli.js encode "$TARGET_DIR" -o "$OUTPUT_COMPRESSED" 2>&1)
END_TIME=$(date +%s%N)

ELAPSED_COMP=$(( (END_TIME - START_TIME) / 1000000 ))  # en millisecondes
ELAPSED_COMP_SEC=$(echo "scale=3; $ELAPSED_COMP / 1000" | bc)

echo "$OUTPUT1"
echo ""

# Obtenir la taille du fichier compressé
SIZE_COMP=0
RATIO_COMP=0
if [ -f "$OUTPUT_COMPRESSED" ]; then
    SIZE_COMP=$(du -b "$OUTPUT_COMPRESSED" | cut -f1)
    SIZE_COMP_MB=$((SIZE_COMP / 1024 / 1024))
    RATIO_COMP=$(echo "scale=2; $SIZE_COMP * 100 / $TOTAL_SIZE" | bc)
    echo "✅ Fichier compressé: $OUTPUT_COMPRESSED"
    echo "   Taille: $SIZE_COMP_MB MB ($SIZE_COMP bytes)"
    echo "   Ratio: ${RATIO_COMP}%"
fi
echo "⏱️  Temps total: ${ELAPSED_COMP_SEC}s"
echo ""

THROUGHPUT_COMP="N/A"
if [ ! -z "$ELAPSED_COMP_SEC" ] && [ "$ELAPSED_COMP_SEC" != "0" ]; then
    THROUGHPUT_COMP=$(echo "scale=2; $TOTAL_SIZE_MB / $ELAPSED_COMP_SEC" | bc)
    echo "🚀 Débit: ${THROUGHPUT_COMP} MB/s"
fi
echo ""

# Test 2: Sans compression (pour comparer)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗂️  TEST 2: SANS COMPRESSION (PNG brut, baseline)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

START_TIME=$(date +%s%N)
OUTPUT2=$(node dist/cli.js encode "$TARGET_DIR" -o "$OUTPUT_UNCOMPRESSED" --no-compress 2>&1)
END_TIME=$(date +%s%N)

ELAPSED_UNCOMP=$(( (END_TIME - START_TIME) / 1000000 ))  # en millisecondes
ELAPSED_UNCOMP_SEC=$(echo "scale=3; $ELAPSED_UNCOMP / 1000" | bc)

echo "$OUTPUT2"
echo ""

# Obtenir la taille du fichier non compressé
SIZE_UNCOMP=0
RATIO_UNCOMP=0
if [ -f "$OUTPUT_UNCOMPRESSED" ]; then
    SIZE_UNCOMP=$(du -b "$OUTPUT_UNCOMPRESSED" | cut -f1)
    SIZE_UNCOMP_MB=$((SIZE_UNCOMP / 1024 / 1024))
    RATIO_UNCOMP=$(echo "scale=2; $SIZE_UNCOMP * 100 / $TOTAL_SIZE" | bc)
    echo "✅ Fichier (sans compression): $OUTPUT_UNCOMPRESSED"
    echo "   Taille: $SIZE_UNCOMP_MB MB ($SIZE_UNCOMP bytes)"
    echo "   Ratio: ${RATIO_UNCOMP}%"
fi
echo "⏱️  Temps total: ${ELAPSED_UNCOMP_SEC}s"
echo ""

THROUGHPUT_UNCOMP="N/A"
if [ ! -z "$ELAPSED_UNCOMP_SEC" ] && [ "$ELAPSED_UNCOMP_SEC" != "0" ]; then
    THROUGHPUT_UNCOMP=$(echo "scale=2; $TOTAL_SIZE_MB / $ELAPSED_UNCOMP_SEC" | bc)
    echo "🚀 Débit: ${THROUGHPUT_UNCOMP} MB/s"
fi
echo ""

# Résumé
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  📊 RÉSUMÉ DÉTAILLÉ                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

echo "📥 Données d'entrée:"
echo "   Répertoire: $TARGET_DIR"
echo "   Taille: $TOTAL_SIZE_MB MB"
echo ""

echo "📦 Avec Compression (Zstd):"
echo "   Taille: $SIZE_COMP_MB MB"
echo "   Ratio compression: ${RATIO_COMP}%"
echo "   Économies: $((TOTAL_SIZE_MB - SIZE_COMP_MB)) MB"
echo "   Temps: ${ELAPSED_COMP_SEC}s"
echo "   Débit: ${THROUGHPUT_COMP} MB/s"
echo ""

echo "🗂️  Sans Compression (baseline):"
echo "   Taille: $SIZE_UNCOMP_MB MB"
echo "   Ratio PNG: ${RATIO_UNCOMP}%"
echo "   Temps: ${ELAPSED_UNCOMP_SEC}s"
echo "   Débit: ${THROUGHPUT_UNCOMP} MB/s"
echo ""

# Calculs de gains
if [ "$SIZE_UNCOMP" != "0" ]; then
    COMPRESSION_PERC=$(echo "scale=2; ($SIZE_UNCOMP - $SIZE_COMP) * 100 / $SIZE_UNCOMP" | bc)
    COMPRESSION_MB=$((SIZE_UNCOMP_MB - SIZE_COMP_MB))
    echo "📉 Gain de Compression:"
    echo "   Réduction: ${COMPRESSION_PERC}%"
    echo "   Espace économisé: $COMPRESSION_MB MB"
fi

if [ "$ELAPSED_UNCOMP_SEC" != "0" ]; then
    SPEED_RATIO=$(echo "scale=2; $ELAPSED_UNCOMP_SEC / $ELAPSED_COMP_SEC" | bc)
    echo ""
    echo "⚡ Impact Performance:"
    if (( $(echo "$SPEED_RATIO > 1" | bc -l) )); then
        echo "   La compression rend le traitement ${SPEED_RATIO}x plus lent"
    else
        echo "   Pas de ralentissement significatif (facteur: ${SPEED_RATIO}x)"
    fi
fi

echo ""
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Stats finales
echo "📊 STATISTIQUES FINALES:"
echo "   Fichier compressé: $(du -h $OUTPUT_COMPRESSED | cut -f1)"
echo "   Fichier non compressé: $(du -h $OUTPUT_UNCOMPRESSED | cut -f1)"
echo ""
echo "💾 Fichiers générés dans /tmp:"
echo "   - glados-compressed.png"
echo "   - glados-uncompressed.png"
echo ""
