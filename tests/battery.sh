#!/usr/bin/env bash
set -euo pipefail

BIN="/mnt/windata/C/Users/Yohan/Desktop/Projets/roxify/target/release/roxify_native"
SRC="/home/yohan/Bureau/Projets"
RAM_LIMIT_MB=28000

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

PASS=0
FAIL=0
RESULTS=""

check_ram() {
    local used_mb
    used_mb=$(free -m | awk '/^Mem:/{print $3}')
    if [ "$used_mb" -ge "$RAM_LIMIT_MB" ]; then
        echo -e "${RED}ABORT: RAM usage ${used_mb}MB >= ${RAM_LIMIT_MB}MB limit!${NC}"
        exit 99
    fi
}

run_test() {
    local name="$1"
    shift
    local start end ms
    check_ram
    start=$(date +%s%N)
    if "$@" ; then
        end=$(date +%s%N)
        ms=$(( (end - start) / 1000000 ))
        echo -e "  ${GREEN}PASS${NC} ${name} (${ms}ms)"
        RESULTS="${RESULTS}\n  PASS ${name} (${ms}ms)"
        PASS=$((PASS + 1))
        check_ram
        return 0
    else
        end=$(date +%s%N)
        ms=$(( (end - start) / 1000000 ))
        echo -e "  ${RED}FAIL${NC} ${name} (${ms}ms)"
        RESULTS="${RESULTS}\n  FAIL ${name} (${ms}ms)"
        FAIL=$((FAIL + 1))
        return 1
    fi
}

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

echo "═══════════════════════════════════════════════════"
echo " ROXIFY RELEASE BATTERY TESTS"
echo " CPU: i7-6700K (8T) | RAM: 32GB (limit: ${RAM_LIMIT_MB}MB)"
echo " Source: $SRC ($(du -sh "$SRC" 2>/dev/null | cut -f1))"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── TEST 1: Encode full directory ───────────────────────────────────────
echo "── TEST 1: Encode (full directory → PNG, level 3) ──"
PNG="$TMP/full.png"
run_test "encode_full" "$BIN" encode "$SRC" "$PNG" --level 3
PNG_SIZE=$(stat --printf="%s" "$PNG" 2>/dev/null || echo 0)
SRC_SIZE=$(du -sb "$SRC" | cut -f1)
RATIO=$((PNG_SIZE * 100 / SRC_SIZE))
echo "  → $(numfmt --to=iec $SRC_SIZE) → $(numfmt --to=iec $PNG_SIZE) (ratio: ${RATIO}%)"
echo ""

# ─── TEST 2: Decode full ─────────────────────────────────────────────────
echo "── TEST 2: Decode (full extraction) ──"
DECODE_OUT="$TMP/decode_full"
mkdir -p "$DECODE_OUT"
run_test "decode_full" "$BIN" decompress "$PNG" "$DECODE_OUT"
DECODED_COUNT=$(find "$DECODE_OUT" -type f | wc -l)
EXPECTED_COUNT=$(find "$SRC" -type f | wc -l)
echo "  → Files: $DECODED_COUNT / $EXPECTED_COUNT"
echo ""

# ─── TEST 3: --files single file (speed + low RAM) ───────────────────────
echo "── TEST 3: --files (single file extraction) ──"
SINGLE_OUT="$TMP/single"
mkdir -p "$SINGLE_OUT"
run_test "files_single" "$BIN" decompress "$PNG" "$SINGLE_OUT" --files "roxify/package.json"
if [ -f "$SINGLE_OUT/roxify/package.json" ] || [ -f "$SINGLE_OUT/package.json" ]; then
    echo "  → File found: OK"
else
    echo -e "  → ${RED}File NOT found${NC}"
    FAIL=$((FAIL + 1))
fi
echo ""

# ─── TEST 4: --files multiple files ──────────────────────────────────────
echo "── TEST 4: --files (3 files extraction) ──"
MULTI_OUT="$TMP/multi"
mkdir -p "$MULTI_OUT"
run_test "files_multi" "$BIN" decompress "$PNG" "$MULTI_OUT" --files '["roxify/package.json","roxify/Cargo.toml","roxify/native/main.rs"]'
MULTI_COUNT=$(find "$MULTI_OUT" -type f | wc -l)
echo "  → Files extracted: $MULTI_COUNT (expected: 3)"
echo ""

# ─── TEST 5: Integrity check (10 random files) ───────────────────────────
echo "── TEST 5: Integrity (10 random files) ──"
INTEGRITY_PASS=0
INTEGRITY_FAIL=0
mapfile -t RANDOM_FILES < <(find "$SRC" -type f -size +0c | shuf -n 10)
for f in "${RANDOM_FILES[@]}"; do
    REL="${f#$SRC/}"
    DECODED_FILE="$DECODE_OUT/$REL"
    if [ -f "$DECODED_FILE" ]; then
        if cmp -s "$f" "$DECODED_FILE"; then
            INTEGRITY_PASS=$((INTEGRITY_PASS + 1))
        else
            echo -e "  ${RED}MISMATCH: $REL${NC}"
            INTEGRITY_FAIL=$((INTEGRITY_FAIL + 1))
        fi
    else
        echo -e "  ${YELLOW}MISSING: $REL${NC}"
        INTEGRITY_FAIL=$((INTEGRITY_FAIL + 1))
    fi
done
if [ "$INTEGRITY_FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} integrity ($INTEGRITY_PASS/$((INTEGRITY_PASS + INTEGRITY_FAIL)))"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}FAIL${NC} integrity ($INTEGRITY_PASS/$((INTEGRITY_PASS + INTEGRITY_FAIL)))"
    FAIL=$((FAIL + 1))
fi
echo ""

# ─── TEST 6: Encode+Decode small directory ────────────────────────────────
echo "── TEST 6: Roundtrip small directory (roxify/) ──"
SMALL_PNG="$TMP/small.png"
SMALL_OUT="$TMP/small_out"
mkdir -p "$SMALL_OUT"
run_test "encode_small" "$BIN" encode "$SRC/roxify" "$SMALL_PNG" --level 3
run_test "decode_small" "$BIN" decompress "$SMALL_PNG" "$SMALL_OUT"
SMALL_DECODED=$(find "$SMALL_OUT" -type f | wc -l)
SMALL_EXPECTED=$(find "$SRC/roxify" -type f | wc -l)
echo "  → Files: $SMALL_DECODED / $SMALL_EXPECTED"
echo ""

# ─── TEST 7: Encode level 1 (speed) ──────────────────────────────────────
echo "── TEST 7: Encode speed (level 1) ──"
FAST_PNG="$TMP/fast.png"
run_test "encode_lvl1" "$BIN" encode "$SRC" "$FAST_PNG" --level 1
FAST_SIZE=$(stat --printf="%s" "$FAST_PNG" 2>/dev/null || echo 0)
echo "  → Size: $(numfmt --to=iec $FAST_SIZE)"
echo ""

# ─── TEST 8: --files should NOT use excessive RAM ─────────────────────────
echo "── TEST 8: --files RAM check (must stay < +500MB) ──"
RAM_BEFORE=$(free -m | awk '/^Mem:/{print $3}')
FILES_OUT="$TMP/ram_check"
mkdir -p "$FILES_OUT"
"$BIN" decompress "$PNG" "$FILES_OUT" --files "roxify/package.json" 2>/dev/null
RAM_AFTER=$(free -m | awk '/^Mem:/{print $3}')
RAM_DELTA=$((RAM_AFTER - RAM_BEFORE))
if [ "$RAM_DELTA" -lt 500 ]; then
    echo -e "  ${GREEN}PASS${NC} --files RAM delta: ${RAM_DELTA}MB (< 500MB)"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}FAIL${NC} --files RAM delta: ${RAM_DELTA}MB (>= 500MB!)"
    FAIL=$((FAIL + 1))
fi
echo ""

# ─── TEST 9: Encrypted encode/decode ─────────────────────────────────────
echo "── TEST 9: Encrypted roundtrip (AES) ──"
ENC_PNG="$TMP/encrypted.png"
ENC_OUT="$TMP/enc_out"
mkdir -p "$ENC_OUT"
run_test "encode_encrypted" "$BIN" encode "$SRC/roxify" "$ENC_PNG" --level 3 --passphrase "test123"
run_test "decode_encrypted" "$BIN" decompress "$ENC_PNG" "$ENC_OUT" --passphrase "test123"
ENC_FILES=$(find "$ENC_OUT" -type f | wc -l)
echo "  → Encrypted files decoded: $ENC_FILES"
echo ""

# ─── TEST 10: List command ────────────────────────────────────────────────
echo "── TEST 10: List files from PNG ──"
LIST_OUTPUT=$("$BIN" list "$PNG" 2>/dev/null || echo "FAIL")
if echo "$LIST_OUTPUT" | grep -q "name"; then
    LIST_COUNT=$(echo "$LIST_OUTPUT" | grep -o '"name"' | wc -l)
    echo -e "  ${GREEN}PASS${NC} list ($LIST_COUNT entries)"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}FAIL${NC} list command returned no entries"
    FAIL=$((FAIL + 1))
fi
echo ""

# ─── TEST 11: --files on encrypted ───────────────────────────────────────
echo "── TEST 11: --files on encrypted PNG ──"
ENCF_OUT="$TMP/enc_files"
mkdir -p "$ENCF_OUT"
run_test "files_encrypted" "$BIN" decompress "$ENC_PNG" "$ENCF_OUT" --passphrase "test123" --files "package.json"
echo ""

# ─── FINAL RAM CHECK ─────────────────────────────────────────────────────
check_ram
echo ""
echo "═══════════════════════════════════════════════════"
echo " RESULTS: ${PASS} passed, ${FAIL} failed"
echo -e "$RESULTS"
echo ""
echo " Performance:"
echo "  Encode 1.1GB: level3"
echo "  Ratio: ${RATIO}%"
echo "  Decoded: $DECODED_COUNT / $EXPECTED_COUNT files"
echo "═══════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
