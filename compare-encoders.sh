#!/bin/bash

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  🧪 TEST DE COMPARAISON - Rust vs TypeScript Encoder         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

TEST_DIR="/tmp/test-small-dir"
CLI="node dist/cli.js"

if [ ! -d "$TEST_DIR" ]; then
    echo "❌ Test directory not found: $TEST_DIR"
    exit 1
fi

TEST_SIZE=$(du -sb "$TEST_DIR" | awk '{print $1}')
TEST_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", $TEST_SIZE/1048576}")

echo "📦 Test data: $TEST_SIZE_MB MB"
echo ""

echo "🦀 Test 1: CLI with Rust encoder (default)"
rm -f /tmp/test-rust.png
START=$(date +%s%N)
$CLI encode "$TEST_DIR" /tmp/test-rust.png 2>&1 | tail -6
END=$(date +%s%N)
RUST_TIME=$(awk "BEGIN {printf \"%.3f\", ($END - $START)/1000000000}")
RUST_SIZE=$(stat -c%s /tmp/test-rust.png)
RUST_RATIO=$(awk "BEGIN {printf \"%.2f\", ($RUST_SIZE/$TEST_SIZE)*100}")

echo ""
echo "📘 Test 2: CLI with TypeScript encoder (--force-ts)"
rm -f /tmp/test-ts.png
START=$(date +%s%N)
$CLI encode "$TEST_DIR" /tmp/test-ts.png --force-ts 2>&1 | tail -6
END=$(date +%s%N)
TS_TIME=$(awk "BEGIN {printf \"%.3f\", ($END - $START)/1000000000}")
TS_SIZE=$(stat -c%s /tmp/test-ts.png)
TS_RATIO=$(awk "BEGIN {printf \"%.2f\", ($TS_SIZE/$TEST_SIZE)*100}")

echo ""
echo "⚙️  Test 3: Direct Rust binary"
rm -f /tmp/test-direct.png
START=$(date +%s%N)
/home/yohan/roxify/target/release/roxify_native encode "$TEST_DIR" /tmp/test-direct.png 2>/dev/null
END=$(date +%s%N)
DIRECT_TIME=$(awk "BEGIN {printf \"%.3f\", ($END - $START)/1000000000}")
DIRECT_SIZE=$(stat -c%s /tmp/test-direct.png)
DIRECT_RATIO=$(awk "BEGIN {printf \"%.2f\", ($DIRECT_SIZE/$TEST_SIZE)*100}")

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                      RÉSULTATS COMPARATIFS                    ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Méthode              │  Taille    │  Ratio  │   Temps       ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
printf "║  CLI (Rust)           │  %6d KB │ %5.1f%% │ %7.3fs     ║\n" $((RUST_SIZE/1024)) "$RUST_RATIO" "$RUST_TIME"
printf "║  CLI (TypeScript)     │  %6d KB │ %5.1f%% │ %7.3fs     ║\n" $((TS_SIZE/1024)) "$TS_RATIO" "$TS_TIME"
printf "║  Binaire Rust direct  │  %6d KB │ %5.1f%% │ %7.3fs     ║\n" $((DIRECT_SIZE/1024)) "$DIRECT_RATIO" "$DIRECT_TIME"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

if [ "$RUST_SIZE" -eq "$DIRECT_SIZE" ]; then
    echo "✅ Le CLI utilise correctement le binaire Rust (tailles identiques)"
else
    echo "⚠️  Différence entre CLI et binaire direct: $((RUST_SIZE - DIRECT_SIZE)) bytes"
fi

SPEEDUP=$(awk "BEGIN {printf \"%.1f\", $TS_TIME/$RUST_TIME}")
SIZE_REDUCTION=$(awk "BEGIN {printf \"%.1f\", (($TS_SIZE-$RUST_SIZE)/$TS_SIZE)*100}")

echo "📊 Le mode Rust est ${SPEEDUP}x plus rapide que TypeScript"
echo "💾 Le mode Rust génère des fichiers ${SIZE_REDUCTION}% plus petits"
