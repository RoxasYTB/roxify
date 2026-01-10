#!/bin/bash

set -e
export LC_NUMERIC=C

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🧪 BENCHMARK ROXIFY (Rust CLI direct) - Système adaptatif   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

DATA_DIR="/home/yohan/test-compression-data"
RESULTS_DIR="/home/yohan/compression-benchmark-results-rust"
mkdir -p "$RESULTS_DIR"

BIN="./target/release/roxify_native"

if [ ! -f "$BIN" ]; then
    echo "❌ Binaire non trouvé: $BIN"
    exit 1
fi

echo "✅ Binaire: $BIN ($(ls -lh $BIN | awk '{print $6, $7, $8}'))"
echo ""

for size_mb in 200 500 1000 2000 4000; do
    file="$DATA_DIR/test-${size_mb}mb.bin"

    if [ ! -f "$file" ]; then
        echo "⏭️  $file manquant"
        continue
    fi

    echo "📦 ${size_mb} MB Dataset:"

    input_bytes=$(stat -c%s "$file")
    output="$RESULTS_DIR/test-${size_mb}mb.zst"

    echo -n "  roxify     "

    start=$(date +%s%3N)
    $BIN compress "$file" "$output" --level 19 2>/dev/null || {
        echo "❌ Erreur"
        continue
    }
    end=$(date +%s%3N)

    elapsed_ms=$((end - start))
    elapsed_s=$(awk "BEGIN {printf \"%.3f\", $elapsed_ms/1000}")

    output_bytes=$(stat -c%s "$output" 2>/dev/null || echo "0")

    if [ "$output_bytes" = "0" ]; then
        echo "❌ Fichier sortie vide"
        continue
    fi

    ratio=$(awk "BEGIN {printf \"%.1f\", ($output_bytes/$input_bytes)*100}")
    compression=$(awk "BEGIN {printf \"%.1f\", 100-($output_bytes/$input_bytes)*100}")
    throughput=$(awk "BEGIN {printf \"%.1f\", ($input_bytes/1024/1024)/$elapsed_s}")

    input_hr=$(numfmt --to=iec-i --suffix=B $input_bytes | sed 's/iB//')
    output_hr=$(numfmt --to=iec-i --suffix=B $output_bytes | sed 's/iB//')

    printf "%8s: %8s → %8s (%5.1f%% ratio, %5.1f%% compression) @ %6.1f MB/s (%6.3fs)\n" \
        "$input_hr" "$input_hr" "$output_hr" "$ratio" "$compression" "$throughput" "$elapsed_s"

    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Benchmark terminé"
echo "📂 Résultats: $RESULTS_DIR"
