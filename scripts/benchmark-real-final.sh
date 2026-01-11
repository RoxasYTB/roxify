#!/bin/bash

set -e
export LC_NUMERIC=C

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🧪 BENCHMARK FINAL - Données Réelles (Codebase)             ║"
echo "║  Roxify vs LZMA vs GZIP sur données réelles                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

DATA_DIR="/home/yohan/test-real-data"
RESULTS_DIR="/home/yohan/benchmark-real-results"
mkdir -p "$RESULTS_DIR"

ROXIFY_BIN="/home/yohan/roxify/target/release/roxify_native"

if [ ! -f "$ROXIFY_BIN" ]; then
    echo "❌ Binaire Roxify non trouvé"
    exit 1
fi

echo "📂 Datasets:"
for dir in "$DATA_DIR"/codebase-*mb; do
    if [ -d "$dir" ]; then
        size=$(du -sh "$dir" | awk '{print $1}')
        files=$(find "$dir" -type f | wc -l)
        echo "  ✓ $dir ($size, $files fichiers)"
    fi
done
echo ""

CSV_FILE="$RESULTS_DIR/real-benchmark-results.csv"
echo "Size_MB,Compressor,Input_MB,Output_MB,Ratio_Pct,Time_Sec,Throughput_MBs" > "$CSV_FILE"

hr() {
    local bytes=$1
    if [ "$bytes" -ge 1073741824 ]; then
        awk "BEGIN {printf \"%.2f GB\", $bytes/1073741824}"
    elif [ "$bytes" -ge 1048576 ]; then
        awk "BEGIN {printf \"%.2f MB\", $bytes/1048576}"
    elif [ "$bytes" -ge 1024 ]; then
        awk "BEGIN {printf \"%.2f KB\", $bytes/1024}"
    else
        echo "${bytes} B"
    fi
}

run_test() {
    local input_dir=$1
    local size_label=$2
    local compressor=$3

    local size_bytes=$(du -sb "$input_dir" | awk '{print $1}')
    local size_mb=$(awk "BEGIN {printf \"%.2f\", $size_bytes/1048576}")

    printf "  %-10s %-8s: " "$compressor" "$(hr $size_bytes)"

    local output="$RESULTS_DIR/out-${size_label}-${compressor}"
    rm -f "$output"

    local start=$(date +%s%N)

    case $compressor in
        roxify)
            timeout 600 "$ROXIFY_BIN" encode "$input_dir" "$output" 2>/dev/null || {
                echo "❌ erreur"
                return
            }
            ;;
        gzip)
            timeout 600 tar -czf "$output" -C "$(dirname "$input_dir")" "$(basename "$input_dir")" 2>/dev/null || {
                echo "❌ erreur"
                return
            }
            ;;
        lzma)
            timeout 600 tar --lzma -cf "$output" -C "$(dirname "$input_dir")" "$(basename "$input_dir")" 2>/dev/null || {
                echo "❌ erreur"
                return
            }
            ;;
    esac

    local end=$(date +%s%N)
    local elapsed_ns=$((end - start))
    local elapsed_s=$(awk "BEGIN {printf \"%.3f\", $elapsed_ns/1000000000}")

    if [ -f "$output" ]; then
        local out_bytes=$(stat -c%s "$output")
        local out_mb=$(awk "BEGIN {printf \"%.2f\", $out_bytes/1048576}")
        local ratio=$(awk "BEGIN {printf \"%.1f\", ($out_bytes/$size_bytes)*100}")
        local compression=$(awk "BEGIN {printf \"%.1f\", 100-($out_bytes/$size_bytes)*100}")
        local throughput=$(awk "BEGIN {printf \"%.1f\", $size_mb/$elapsed_s}")

        printf "%8s → %8s (%5.1f%%, %5.1f%% comp) @ %6.1f MB/s (%6.3fs)\n" \
            "$(hr $size_bytes)" "$(hr $out_bytes)" "$ratio" "$compression" "$throughput" "$elapsed_s"

        echo "$size_label,$compressor,$size_mb,$out_mb,$ratio,$elapsed_s,$throughput" >> "$CSV_FILE"
    else
        echo "❌ fichier sortie manquant"
    fi
}

echo "🧪 BENCHMARK EN COURS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

dir="$DATA_DIR/codebase-4000mb"
if [ -d "$dir" ]; then
    echo "📦 4000mb Dataset:"
    run_test "$dir" "4000mb" "roxify"
    run_test "$dir" "4000mb" "gzip"
    run_test "$dir" "4000mb" "lzma"
    echo ""
else
    echo "❌ Dataset 4000mb non trouvé: $dir"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 RÉSUMÉ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "$CSV_FILE" ]; then
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║         BENCHMARK DONNÉES RÉELLES - RÉSULTATS                  ║"
    echo "╠════════════════════════════════════════════════════════════════╣"
    echo "║  Size     │ Compressor │  Ratio  │   Time  │  Throughput     ║"
    echo "╠════════════════════════════════════════════════════════════════╣"

    tail -n +2 "$CSV_FILE" | sort -t',' -k1,1 | while IFS=',' read -r size comp in_mb out_mb ratio time throughput; do
        printf "║  %-8s │ %-10s │ %6.1f%% │ %7.2fs │ %8.1f MB/s ║\n" \
            "$size" "$comp" "$ratio" "$time" "$throughput"
    done

    echo "╚════════════════════════════════════════════════════════════════╝"
fi

echo ""
echo "📈 CSV: $CSV_FILE"
echo "📂 Résultats: $RESULTS_DIR"
