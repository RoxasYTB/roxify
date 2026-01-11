#!/bin/bash

set -e

CODEBASE_DIR="/home/yohan/Musique/codebase"
OUTPUT_DIR="/home/yohan/test-real-data"

if [ ! -d "$CODEBASE_DIR" ]; then
    echo "❌ Codebase non trouvée: $CODEBASE_DIR"
    exit 1
fi

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  📦 Génération de datasets réels (codebase)                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

BASE_SIZE=$(du -sb "$CODEBASE_DIR" | awk '{print $1}')
BASE_SIZE_MB=$((BASE_SIZE / 1024 / 1024))

echo "📂 Codebase de base: ${BASE_SIZE_MB} MB"
echo "📁 Destination: $OUTPUT_DIR"
echo ""

mkdir -p "$OUTPUT_DIR"

generate_dataset() {
    local target_mb=$1
    local output_dir="$OUTPUT_DIR/codebase-${target_mb}mb"

    if [ -d "$output_dir" ]; then
        echo "⏭️  ${target_mb}MB existe déjà"
        return
    fi

    echo "⏳ Génération ${target_mb}MB..."

    mkdir -p "$output_dir"

    local needed_copies=$((target_mb / BASE_SIZE_MB + 1))

    for i in $(seq 1 $needed_copies); do
        echo -ne "  Copie $i/${needed_copies}...\r"
        cp -r "$CODEBASE_DIR" "$output_dir/codebase-copy-$i" 2>/dev/null

        current_size=$(du -sb "$output_dir" | awk '{print $1}')
        current_mb=$((current_size / 1024 / 1024))

        if [ $current_mb -ge $target_mb ]; then
            break
        fi
    done

    actual_size=$(du -sb "$output_dir" | awk '{print $1}')
    actual_mb=$((actual_size / 1024 / 1024))
    file_count=$(find "$output_dir" -type f | wc -l)

    echo "  ✅ ${actual_mb} MB créé ($file_count fichiers): $output_dir                "
}

generate_dataset 4000

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Datasets générés:"
for dir in "$OUTPUT_DIR"/codebase-*mb; do
    if [ -d "$dir" ]; then
        size=$(du -sh "$dir" | awk '{print $1}')
        files=$(find "$dir" -type f | wc -l)
        echo "  ✓ $dir ($size, $files fichiers)"
    fi
done
echo ""
echo "✅ Génération terminée"
