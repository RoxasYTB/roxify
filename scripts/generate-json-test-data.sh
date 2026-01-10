#!/bin/bash

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  📊 GÉNÉRATEUR DE DONNÉES BINAIRES ALÉATOIRES DE TEST          ║"
echo "║  Tailles: 200 MB, 500 MB, 1 GB, 2 GB, 4 GB                    ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

OUTPUT_DIR="/tmp/binary-test-data"
mkdir -p "$OUTPUT_DIR"

# Fonction pour générer données binaires aléatoires
generate_binary() {
    local size_mb=$1
    local output_file=$2

    echo "Génération: $(basename $output_file) (${size_mb} MB)..."

    dd if=/dev/urandom of="$output_file" bs=1M count=$size_mb 2>/dev/null

    actual_size=$(du -h "$output_file" | cut -f1)
    echo "  ✓ Généré: $actual_size"
    echo ""
}

# Génération rapide des fichiers de test
echo "🔧 PHASE 1: Génération des fichiers binaires aléatoires"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

generate_binary 200 "$OUTPUT_DIR/test-200mb.bin"
generate_binary 500 "$OUTPUT_DIR/test-500mb.bin"
generate_binary 1000 "$OUTPUT_DIR/test-1gb.bin"
generate_binary 2000 "$OUTPUT_DIR/test-2gb.bin"
generate_binary 4000 "$OUTPUT_DIR/test-4gb.bin"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Fichiers binaires générés dans: $OUTPUT_DIR"
echo ""
ls -lh "$OUTPUT_DIR"/*.bin
