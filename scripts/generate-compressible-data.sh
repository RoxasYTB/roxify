#!/bin/bash

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  📊 GÉNÉRATEUR DONNÉES BINAIRES COMPRESSIBLES                  ║"
echo "║  Pattern répétitif + aléatoire = réaliste                     ║"
echo "║  Tailles: 200 MB, 500 MB, 1 GB, 2 GB                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

OUTPUT_DIR="/home/yohan/test-compression-data"
mkdir -p "$OUTPUT_DIR"

# Générer données compressibles avec patterns répétitifs
generate_compressible() {
    local size_mb=$1
    local output_file=$2

    echo "Génération: $(basename $output_file) (${size_mb} MB)..."

    # Créer un fichier avec patterns répétitifs
    # 70% pattern répétitif + 30% aléatoire (réaliste)
    python3 << PYTHON
import os
import random

size_bytes = $size_mb * 1024 * 1024
pattern = b"Lorem ipsum dolor sit amet consectetur adipiscing elit. " * 100
pattern_ratio = 0.7  # 70% patterns, 30% random

with open("$output_file", "wb") as f:
    written = 0
    while written < size_bytes:
        if random.random() < pattern_ratio:
            # Write pattern
            chunk = pattern[:min(len(pattern), size_bytes - written)]
            f.write(chunk)
            written += len(chunk)
        else:
            # Write random data
            chunk_size = min(1024, size_bytes - written)
            f.write(os.urandom(chunk_size))
            written += chunk_size

        # Progress
        if written % (10 * 1024 * 1024) == 0:
            progress = int(written * 100 / size_bytes)
            print(f"  Progress: {progress}%", flush=True)

print(f"  ✓ Généré: {written // 1024 // 1024} MB")
PYTHON

    echo ""
}

# Génération rapide
echo "🔧 PHASE 1: Génération des fichiers compressibles"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

generate_compressible 200 "$OUTPUT_DIR/test-200mb.bin"
generate_compressible 500 "$OUTPUT_DIR/test-500mb.bin"
generate_compressible 1000 "$OUTPUT_DIR/test-1gb.bin"
generate_compressible 2000 "$OUTPUT_DIR/test-2gb.bin"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Fichiers compressibles générés dans: $OUTPUT_DIR"
echo ""
ls -lh "$OUTPUT_DIR"/*.bin | awk '{print "  " $9 " (" $5 ")"}'
