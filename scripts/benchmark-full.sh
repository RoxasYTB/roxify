#!/usr/bin/env bash
set -euo pipefail

ROXIFY="${ROXIFY_BIN:-/tmp/roxify-build/release/roxify_native}"
RESULTS_DIR="/tmp/roxify-bench-results"
SMALL_DIR="/home/yohan/Bureau/_Projets/Glados-Disc"
LARGE_DIR="/home/yohan/Téléchargements/Gmod"
RUNS=3

mkdir -p "$RESULTS_DIR"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$1"; }

bench_encode() {
    local label="$1" input="$2" output="$3" extra_args="${4:-}"
    local times=()
    local sizes=()

    for i in $(seq 1 "$RUNS"); do
        rm -f "$output"
        local start end elapsed
        start=$(date +%s%N)
        eval "$ROXIFY encode \"$input\" \"$output\" $extra_args" 2>/dev/null
        end=$(date +%s%N)
        elapsed=$(( (end - start) / 1000000 ))
        times+=("$elapsed")
        if [[ -f "$output" ]]; then
            sizes+=("$(stat -c%s "$output")")
        else
            sizes+=("0")
        fi
        log "  $label encode run $i: ${elapsed}ms"
    done

    local sum=0
    for t in "${times[@]}"; do sum=$((sum + t)); done
    local avg=$((sum / RUNS))

    local input_size
    if [[ -d "$input" ]]; then
        input_size=$(du -sb "$input" | cut -f1)
    else
        input_size=$(stat -c%s "$input")
    fi

    local last_size="${sizes[-1]}"
    local ratio="0"
    if [[ "$input_size" -gt 0 && "$last_size" -gt 0 ]]; then
        ratio=$(awk "BEGIN{printf \"%.2f\", $last_size / $input_size * 100}")
    fi

    printf '%-30s | input: %10s | output: %10s | ratio: %5s%% | avg: %6dms | runs: %s\n' \
        "$label" \
        "$(numfmt --to=iec "$input_size")" \
        "$(numfmt --to=iec "$last_size")" \
        "$ratio" \
        "$avg" \
        "$(IFS=,; echo "${times[*]}")"
}

bench_decode() {
    local label="$1" input="$2" output_dir="$3" extra_args="${4:-}"
    local times=()

    for i in $(seq 1 "$RUNS"); do
        rm -rf "$output_dir"
        mkdir -p "$output_dir"
        local start end elapsed
        start=$(date +%s%N)
        eval "$ROXIFY decompress \"$input\" \"$output_dir\" $extra_args" 2>/dev/null
        end=$(date +%s%N)
        elapsed=$(( (end - start) / 1000000 ))
        times+=("$elapsed")
        log "  $label decode run $i: ${elapsed}ms"
    done

    local sum=0
    for t in "${times[@]}"; do sum=$((sum + t)); done
    local avg=$((sum / RUNS))

    printf '%-30s | avg decode: %6dms | runs: %s\n' \
        "$label" "$avg" "$(IFS=,; echo "${times[*]}")"
}

bench_encode_decode_pair() {
    local label="$1" input="$2" encoded="$3" decoded_dir="$4" extra_enc="${5:-}" extra_dec="${6:-}"
    bench_encode "$label" "$input" "$encoded" "$extra_enc"
    bench_decode "$label" "$encoded" "$decoded_dir" "$extra_dec"
}

echo "========================================"
echo "  ROXIFY BENCHMARK — $(date)"
echo "  Binary: $ROXIFY"
echo "  Runs per test: $RUNS"
echo "========================================"
echo ""

log "=== TEST 1: Small directory (Glados-Disc ~172MB) ==="
bench_encode_decode_pair \
    "small-dir-no-pass" \
    "$SMALL_DIR" \
    "$RESULTS_DIR/small.png" \
    "$RESULTS_DIR/small-decoded"

log "=== TEST 2: Small directory with passphrase ==="
bench_encode_decode_pair \
    "small-dir-aes" \
    "$SMALL_DIR" \
    "$RESULTS_DIR/small-aes.png" \
    "$RESULTS_DIR/small-aes-decoded" \
    "--passphrase benchtest123" \
    "--passphrase benchtest123"

log "=== TEST 3: Large directory (Gmod ~2.1GB) ==="
bench_encode_decode_pair \
    "large-dir-no-pass" \
    "$LARGE_DIR" \
    "$RESULTS_DIR/large.png" \
    "$RESULTS_DIR/large-decoded"

log "=== TEST 4: Large directory with passphrase ==="
bench_encode_decode_pair \
    "large-dir-aes" \
    "$LARGE_DIR" \
    "$RESULTS_DIR/large-aes.png" \
    "$RESULTS_DIR/large-aes-decoded" \
    "--passphrase benchtest123" \
    "--passphrase benchtest123"

log "=== TEST 5: Single large file (model.glb ~26MB) ==="
bench_encode_decode_pair \
    "single-26mb" \
    "$LARGE_DIR/model.glb" \
    "$RESULTS_DIR/single26.png" \
    "$RESULTS_DIR/single26-decoded"

echo ""
echo "========================================"
echo "  BENCHMARK COMPLETE"
echo "========================================"
