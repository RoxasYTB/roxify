#!/bin/bash

set -e
export LC_NUMERIC=C

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🧪 BENCHMARK COMPRESSION - Roxify vs Alternatives            ║"
echo "║  Données: 10MB randoms répétés (très compressibles)           ║"
echo "║  Tailles: 200 MB → 4 GB                                       ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

DATA_DIR="/home/yohan/test-compression-data"
RESULTS_DIR="/home/yohan/compression-benchmark-results"
mkdir -p "$RESULTS_DIR"

CSV_FILE="$RESULTS_DIR/benchmark-results.csv"
echo "Size_MB,Compressor,Input_MB,Output_MB,Ratio_Pct,Time_Sec,Throughput_MBs,Compression_Pct,Input_HR,Output_HR" > "$CSV_FILE"

# Générer des données répétitives si manquantes
# Format bytes to human-readable string
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

generate_repetitive_data() {
    local size_mb=$1
    local file="$DATA_DIR/test-${size_mb}mb.bin"
    if [ ! -f "$file" ]; then
        echo "⏳ Génération de données répétitives pour ${size_mb}MB (90% répétition)..."
        mkdir -p "$DATA_DIR"
        local block_size=$((10 * 1024 * 1024)) # 10 MB
        local reps=$((size_mb / 10))
        local rem_mb=$((size_mb % 10))
        : > "$file"
        for i in $(seq 1 $reps); do
            local salt_size=$((block_size / 10)) # 10% salt
            local left=$(((block_size - salt_size) / 2))
            local right=$((block_size - salt_size - left))
            head -c "$left" /dev/zero >> "$file"
            head -c "$salt_size" /dev/urandom >> "$file"
            head -c "$right" /dev/zero >> "$file"
        done
        if [ $rem_mb -gt 0 ]; then
            local rem_bytes=$((rem_mb * 1024 * 1024))
            local salt_size=$(( (rem_bytes + 9) / 10 )) # ~10%
            local left=$(((rem_bytes - salt_size) / 2))
            local right=$((rem_bytes - salt_size - left))
            head -c "$left" /dev/zero >> "$file"
            head -c "$salt_size" /dev/urandom >> "$file"
            head -c "$right" /dev/zero >> "$file"
        fi
        echo "  ✓ $file généré"
    fi
}

mkdir -p "$DATA_DIR"
for size in 200 500 1000 2000 4000; do
    generate_repetitive_data $size
done

echo "📂 Données de test:"
ls -lh "$DATA_DIR"/*.bin 2>/dev/null | awk '{print "  ✓ " $9 " (" $5 ")"}'
echo ""

# Tests
echo "🧪 BENCHMARK EN COURS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

run_test() {
    local input_file=$1
    local size_mb=$2
    local compressor=$3

    local size_bytes=$(stat -c%s "$input_file")

    printf "  %-10s %-6s: " "$compressor" "$(hr $size_bytes)"

    local output="$RESULTS_DIR/out-${size_mb}mb-${compressor}"

    local start=$(date +%s%N)

    case $compressor in
        roxify)
            if [ ! -f dist/cli.js ]; then
                echo "⏭️  (not compiled)"
                return
            fi
            timeout 600 node dist/cli.js encode "$input_file" -o "$output" > "$RESULTS_DIR/roxify-${size_mb}mb.log" 2>&1 || {
                echo "❌ (error roxify, voir $RESULTS_DIR/roxify-${size_mb}mb.log)"
                cat "$RESULTS_DIR/roxify-${size_mb}mb.log"
                return
            }
            ;;
        lzma)
            if ! command -v lzma >/dev/null 2>&1; then
                echo "⏭️  (lzma not installed)"
                return
            fi
            timeout 600 lzma -9 -k -c "$input_file" > "$output" 2> "$RESULTS_DIR/lzma-${size_mb}mb.log" || {
                echo "❌ (error lzma, voir $RESULTS_DIR/lzma-${size_mb}mb.log)"
                cat "$RESULTS_DIR/lzma-${size_mb}mb.log"
                return
            }
            ;;
        gzip)
            if ! command -v gzip >/dev/null 2>&1; then
                echo "⏭️  (gzip not installed)"
                return
            fi
            timeout 600 gzip -9 -c "$input_file" > "$output" 2> "$RESULTS_DIR/gzip-${size_mb}mb.log" || {
                echo "❌ (error gzip, voir $RESULTS_DIR/gzip-${size_mb}mb.log)"
                cat "$RESULTS_DIR/gzip-${size_mb}mb.log"
                return
            }
            ;;
    esac

    local end=$(date +%s%N)
    local elapsed_ns=$((end - start))
    local elapsed_s=$(awk "BEGIN {printf \"%.3f\", $elapsed_ns/1000000000}")

    if [ -f "$output" ]; then
        local output_bytes=$(stat -c%s "$output")
        local output_mb=$(awk "BEGIN {printf \"%.2f\", $output_bytes/1024/1024}")
        local ratio=$(awk "BEGIN {printf \"%.1f\", $output_bytes * 100 / $size_bytes}")
        local compression=$(awk "BEGIN {printf \"%.1f\", (1 - $output_bytes / $size_bytes) * 100}")
        local throughput=$(awk "BEGIN {printf \"%.1f\", $size_mb / $elapsed_s}")
        local input_hr=$(hr $size_bytes)
        local output_hr=$(hr $output_bytes)

        printf "%8s → %8s (%5.1f%% ratio, %5.1f%% compression) @ %6.1f MB/s (%6.3fs)\n" \
            "$input_hr" "$output_hr" "$ratio" "$compression" "$throughput" "$elapsed_s"

        echo "$size_mb,$compressor,$size_mb,$output_mb,$ratio,$elapsed_s,$throughput,$compression,$input_hr,$output_hr" >> "$CSV_FILE"
        sync; sleep 0.1
    fi
}

# Test each size
for size_mb in 200 500 1000 2000 4000; do
    file="$DATA_DIR/test-${size_mb}mb.bin"

    if [ ! -f "$file" ]; then
        echo "⏭️  test-${size_mb}mb.bin (not found)"
        continue
    fi

    echo "📦 ${size_mb} MB Dataset:"

    run_test "$file" "$size_mb" "roxify"
    run_test "$file" "$size_mb" "gzip"
    run_test "$file" "$size_mb" "lzma"

    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 RÉSUMÉ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "$CSV_FILE" ]; then
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║              COMPRESSION BENCHMARK RESULTS                      ║"
    echo "╠════════════════════════════════════════════════════════════════╣"
    echo "║  Size   │ Compressor │ Ratio  │ Time │ Throughput │ Compression║"
    echo "╠════════════════════════════════════════════════════════════════╣"

    tail -n +2 "$CSV_FILE" | sort -t',' -k1 -n | awk -F',' '{
        printf "║ %6s │ %-10s │ %8s → %8s │ %5.1f%% │ %7s │ %8.1f MB/s │  %6.1f%%  ║\n",
        $1 "MB", $2, $9, $10, $5, $6 "s", $7, $8
    }'

    echo "╚════════════════════════════════════════════════════════════════╝"
fi

echo ""
echo "🎯 COMPARAISON VITESSE PAR TAILLE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "$CSV_FILE" ]; then
    for size in 200 500 1000 2000 4000; do
        data=$(grep "^$size," "$CSV_FILE")
        if [ -n "$data" ]; then
            echo "📦 ${size} MB:"
            echo "$data" | sort -t',' -k7 -rn | awk -F',' '{
                printf "  %-10s: %6.1f%% compression → %8s @ %8.1f MB/s (%6ss)\n",
                $2, $8, $10, $7, $6
            }'
            echo ""
        fi
    done
fi

echo "📈 CSV: $CSV_FILE"
