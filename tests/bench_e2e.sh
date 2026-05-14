#!/usr/bin/env bash
set -euo pipefail

BIN="/mnt/windata/C/Users/Yohan/Desktop/Projets/roxify/target/release/roxify_native"
SRC="/home/yohan/Bureau/Projets"
TMP=$(mktemp -d)
PNG="$TMP/projets.png"
OUT_DIR="$TMP/decoded"
SINGLE_FILE="roxify/package.json"

echo "=== ROXIFY E2E BENCHMARK ==="
echo "Source: $SRC ($(du -sh "$SRC" | cut -f1), $(find "$SRC" -type f | wc -l) files)"
echo "Temp: $TMP"
echo ""

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# --- TEST 1: ENCODE ---
echo "--- TEST 1: ENCODE (full directory → PNG) ---"
START=$(date +%s%N)
"$BIN" encode "$SRC" "$PNG" --level 3 2>&1 | grep -v "^PROGRESS" || true
END=$(date +%s%N)
ENCODE_MS=$(( (END - START) / 1000000 ))
PNG_SIZE=$(stat --printf="%s" "$PNG" 2>/dev/null || stat -f%z "$PNG")
SRC_SIZE=$(du -sb "$SRC" | cut -f1)
RATIO=$(( PNG_SIZE * 100 / SRC_SIZE ))
echo "  Time: ${ENCODE_MS}ms"
echo "  Source: $(numfmt --to=iec $SRC_SIZE)"
echo "  Output: $(numfmt --to=iec $PNG_SIZE) (${RATIO}% ratio)"
echo ""

# --- TEST 2: DECODE (full) ---
echo "--- TEST 2: DECODE (full extraction) ---"
mkdir -p "$OUT_DIR"
START=$(date +%s%N)
"$BIN" decompress "$PNG" "$OUT_DIR" 2>&1 | grep -v "^PROGRESS" || true
END=$(date +%s%N)
DECODE_MS=$(( (END - START) / 1000000 ))
DECODED_FILES=$(find "$OUT_DIR" -type f | wc -l)
echo "  Time: ${DECODE_MS}ms"
echo "  Files extracted: $DECODED_FILES"
echo ""

# --- TEST 3: DECODE --files (single file) ---
echo "--- TEST 3: DECODE --files (single file: $SINGLE_FILE) ---"
SINGLE_OUT="$TMP/single"
mkdir -p "$SINGLE_OUT"
START=$(date +%s%N)
"$BIN" decompress "$PNG" "$SINGLE_OUT" --files "$SINGLE_FILE" 2>&1 | grep -v "^PROGRESS" || true
END=$(date +%s%N)
SINGLE_MS=$(( (END - START) / 1000000 ))
SINGLE_EXISTS=$(find "$SINGLE_OUT" -type f | wc -l)
echo "  Time: ${SINGLE_MS}ms"
echo "  Files extracted: $SINGLE_EXISTS"
if [ "$SINGLE_EXISTS" -ge 1 ]; then
    echo "  OK: file found"
else
    echo "  WARN: file not found!"
fi
echo ""

# --- TEST 4: INTEGRITY CHECK ---
echo "--- TEST 4: INTEGRITY (spot-check 5 random files) ---"
PASS=0
FAIL=0
# Pick 5 random files from the source
mapfile -t RANDOM_FILES < <(find "$SRC" -type f -size +0c | shuf -n 5)
for f in "${RANDOM_FILES[@]}"; do
    REL="${f#$SRC/}"
    DECODED_FILE="$OUT_DIR/$REL"
    if [ -f "$DECODED_FILE" ]; then
        if cmp -s "$f" "$DECODED_FILE"; then
            PASS=$((PASS + 1))
        else
            echo "  MISMATCH: $REL"
            FAIL=$((FAIL + 1))
        fi
    else
        echo "  MISSING: $REL"
        FAIL=$((FAIL + 1))
    fi
done
echo "  Passed: $PASS / $((PASS + FAIL))"
echo ""

# --- SUMMARY ---
echo "=== SUMMARY ==="
echo "  Encode:  ${ENCODE_MS}ms"
echo "  Decode:  ${DECODE_MS}ms"
echo "  --files: ${SINGLE_MS}ms"
echo "  Ratio:   ${RATIO}%"
echo "  Files:   $DECODED_FILES decoded"
if [ "$FAIL" -gt 0 ]; then
    echo "  INTEGRITY: FAILED ($FAIL errors)"
    exit 1
else
    echo "  INTEGRITY: OK"
fi
