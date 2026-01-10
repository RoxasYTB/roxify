#!/bin/bash

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  📊 GÉNÉRATEUR DONNÉES - 10MB randoms répétés                 ║"
echo "║  Compressibles et rapides à générer                           ║"
echo "║  Tailles: 200 MB, 500 MB, 1 GB, 2 GB                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

OUTPUT_DIR="/home/yohan/test-compression-data"
mkdir -p "$OUTPUT_DIR"

echo "🔧 PHASE 1: Génération des données"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Créer un bloc de 10MB de données aléatoires
BASE_FILE="$OUTPUT_DIR/.base-10mb.bin"
echo "Génération bloc de base (10 MB)..."
dd if=/dev/urandom of="$BASE_FILE" bs=1M count=10 2>/dev/null
echo "  ✓ 10 MB créé"
echo ""

# Créer les fichiers en dupliquant le bloc de base
echo "Duplication pour créer fichiers de test..."
echo ""

echo "Création: test-200mb.bin..."
head -c $((200*1024*1024)) < <(while true; do cat "$BASE_FILE"; done) > "$OUTPUT_DIR/test-200mb.bin"
ls -lh "$OUTPUT_DIR/test-200mb.bin" | awk '{print "  ✓ " $5}'

echo "Création: test-500mb.bin..."
head -c $((500*1024*1024)) < <(while true; do cat "$BASE_FILE"; done) > "$OUTPUT_DIR/test-500mb.bin"
ls -lh "$OUTPUT_DIR/test-500mb.bin" | awk '{print "  ✓ " $5}'

echo "Création: test-1gb.bin..."
head -c $((1000*1024*1024)) < <(while true; do cat "$BASE_FILE"; done) > "$OUTPUT_DIR/test-1gb.bin"
ls -lh "$OUTPUT_DIR/test-1gb.bin" | awk '{print "  ✓ " $5}'

echo "Création: test-2gb.bin..."
head -c $((2000*1024*1024)) < <(while true; do cat "$BASE_FILE"; done) > "$OUTPUT_DIR/test-2gb.bin"
ls -lh "$OUTPUT_DIR/test-2gb.bin" | awk '{print "  ✓ " $5}'

# Cleanup base
rm -f "$BASE_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Fichiers générés dans: $OUTPUT_DIR"
echo ""
ls -lh "$OUTPUT_DIR"/*.bin | awk '{print "  " $9 " (" $5 ")"}'
