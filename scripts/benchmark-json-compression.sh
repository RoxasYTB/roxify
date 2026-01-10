#!/bin/bash

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🧪 BENCHMARK COMPRESSION - Roxify vs Alternatives            ║"
echo "║  200 MB → 4 GB Random Binary Data                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

DATA_DIR="/tmp/binary-test-data"
RESULTS_DIR="/tmp/compression-benchmark-results"
mkdir -p "$RESULTS_DIR"

# Table de résultats
RESULTS_FILE="$RESULTS_DIR/benchmark.txt"
CSV_FILE="$RESULTS_DIR/benchmark.csv"

# Header CSV
echo "Size_MB,Compressor,Input_MB,Output_MB,Ratio_Pct,Time_Sec,Throughput_MB_s,Compression_Pct" > "$CSV_FILE"

# Fonction de test
test_compression() {
    local file=$1
    local compressor=$2
    local output=$3

    local size_bytes=$(stat -c%s "$file")
    local size_mb=$((size_bytes / 1024 / 1024))

    echo "  Testing: $compressor (Input: ${size_mb} MB)..."

    START=$(date +%s%N)

    case $compressor in
        "roxify")
            node dist/cli.js encode "$file" -o "$output" > /dev/null 2>&1
            ;;
        "zstd")
            zstd -19 "$file" -o "$output" > /dev/null 2>&1
            ;;
        "gzip")
            gzip -9 < "$file" > "$output" 2>/dev/null
            ;;
        "brotli")
            brotli -9 < "$file" > "$output" 2>/dev/null
            ;;
    esac

    END=$(date +%s%N)
    ELAPSED=$((($END - $START) / 1000000000))

    if [ -f "$output" ]; then
        output_bytes=$(stat -c%s "$output")
        output_mb=$((output_bytes / 1024 / 1024))
        ratio=$(echo "scale=1; $output_bytes * 100 / $size_bytes" | bc)
        compression=$(echo "scale=1; (1 - $output_bytes / $size_bytes) * 100" | bc)
        throughput=$(echo "scale=2; $size_mb / $ELAPSED" | bc)

        echo "    ✓ Output: ${output_mb} MB (${ratio}% ratio, ${compression}% compression)"
        echo "    ✓ Time: ${ELAPSED}s (${throughput} MB/s)"

        # Append to CSV
        echo "$size_mb,$compressor,$size_mb,$output_mb,$ratio,$ELAPSED,$throughput,$compression" >> "$CSV_FILE"

        return 0
    else
        echo "    ✗ Error - no output file"
        return 1
    fi
}

# Liste des fichiers à tester
FILES=(
    "test-200mb.bin:200"
    "test-500mb.bin:500"
    "test-1gb.bin:1000"
    "test-2gb.bin:2000"
)

COMPRESSORS=("roxify" "zstd" "gzip" "brotli")

echo "✅ Vérification des dépendances..."
echo ""

# Vérifier que les fichiers de test existent
echo "📂 Fichiers de test:"
if [ ! -d "$DATA_DIR" ] || [ -z "$(ls $DATA_DIR/*.bin 2>/dev/null)" ]; then
    echo "  ❌ Fichiers binaires manquants. Génération..."
    chmod +x ./generate-json-test-data.sh
    ./generate-json-test-data.sh
fi

ls -lh "$DATA_DIR"/*.bin 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""

# Vérifier que Roxify est compilé
if [ ! -f "dist/cli.js" ]; then
    echo "❌ dist/cli.js manquant. Compilation..."
    npm run build:all
fi

echo ""
echo "🧪 PHASE 1: Benchmark Compression"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

for file_spec in "${FILES[@]}"; do
    file="${file_spec%:*}"
    size="${file_spec#*:}"

    filepath="$DATA_DIR/$file"

    if [ ! -f "$filepath" ]; then
        echo "⏭️  Skipping $file (not found)"
        continue
    fi

    echo "📊 Testing: $file (${size} MB)"
    echo "─────────────────────────────────────────────"

    for compressor in "${COMPRESSORS[@]}"; do
        output="$RESULTS_DIR/output-${size}mb-$compressor"

        # Check if compressor is available
        case $compressor in
            "zstd")
                if ! command -v zstd >/dev/null 2>&1; then
                    echo "  ⏭️  $compressor not installed, skipping"
                    continue
                fi
                ;;
            "gzip")
                if ! command -v gzip >/dev/null 2>&1; then
                    echo "  ⏭️  $compressor not installed, skipping"
                    continue
                fi
                ;;
            "brotli")
                if ! command -v brotli >/dev/null 2>&1; then
                    echo "  ⏭️  $compressor not installed, skipping"
                    continue
                fi
                ;;
            "roxify")
                if [ ! -f "dist/cli.js" ]; then
                    echo "  ⏭️  roxify not compiled, skipping"
                    continue
                fi
                ;;
        esac

        test_compression "$filepath" "$compressor" "$output"
    done

    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 RÉSUMÉ DES RÉSULTATS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Affiche tableau
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              COMPRESSION BENCHMARK RESULTS                      ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Size   │ Compressor │ Input  │ Output │ Ratio │ Time  │ Speed   ║"
echo "╠════════════════════════════════════════════════════════════════╣"

if [ -f "$CSV_FILE" ]; then
    tail -n +2 "$CSV_FILE" | sort -t',' -k1 -n | while IFS=',' read -r size comp in out ratio time throughput comp_pct; do
        printf "║ %6sMB │ %-10s │ %6sMB │ %6sMB │ %5s%% │ %5ss │ %7s  ║\n" \
            "$size" "$comp" "$in" "$out" "$ratio" "$time" "${throughput}MB/s"
    done
fi

echo "╚════════════════════════════════════════════════════════════════╝"

echo ""
echo "🎯 PERFORMANCE PAR TAILLE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "$CSV_FILE" ]; then
    for size in 200 500 1000 2000; do
        echo "📦 ${size} MB Dataset:"
        grep "^$size," "$CSV_FILE" | sort -t',' -k8 -rn | awk -F',' '{
            printf "  %-10s: %6.1f%% compression @ %6.2f MB/s (%2ds)\n",
            $2, $8, $7, $6
        }'
        echo ""
    done
fi

echo "📈 CSV Export: $CSV_FILE"
echo "📄 Full Report: $RESULTS_FILE"
echo ""
