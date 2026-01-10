#!/bin/bash

set -e

CODEBASE_DIR="/home/yohan/roxify/test-data/codebase"
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
    local output="$OUTPUT_DIR/codebase-${target_mb}mb.tar"
    
    if [ -f "$output" ]; then
        echo "⏭️  ${target_mb}MB existe déjà"
        return
    fi
    
    echo "⏳ Génération ${target_mb}MB..."
    
    local needed_copies=$((target_mb / BASE_SIZE_MB + 1))
    local temp_dir="$OUTPUT_DIR/temp-${target_mb}"
    
    mkdir -p "$temp_dir"
    
    for i in $(seq 1 $needed_copies); do
        cp -r "$CODEBASE_DIR" "$temp_dir/copy-$i" 2>/dev/null || true
        
        current_size=$(du -sb "$temp_dir" | awk '{print $1}')
        current_mb=$((current_size / 1024 / 1024))
        
        if [ $current_mb -ge $target_mb ]; then
            break
        fi
    done
    
    tar -cf "$output" -C "$temp_dir" . 2>/dev/null
    
    rm -rf "$temp_dir"
    
    actual_size=$(stat -c%s "$output")
    actual_mb=$((actual_size / 1024 / 1024))
    
    echo "  ✅ ${actual_mb} MB créé: $output"
}

for size in 200 500 1000 2000 4000; do
    generate_dataset $size
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Datasets générés:"
ls -lh "$OUTPUT_DIR"/*.tar 2>/dev/null | awk '{print "  ✓", $9, "(" $5 ")"}'
echo ""
echo "✅ Génération terminée"
