#!/usr/bin/env bash
# run simple compression benchmarks comparing roxify to 7zip and lz4
# usage: ./scripts/benchmark.sh <file-or-directory> [dict-file]

set -euo pipefail

input="$1"
dict="$2"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

outfile_rox="$tmpdir/out.rox.zst"
outfile_7z="$tmpdir/out.7z"
outfile_lz4="$tmpdir/out.lz4"

fmt="%-20s %-10s %-10s %-10s\n"
printf "$fmt" "tool" "bytes" "compressed" "duration"

function bench {
    local cmd="$1";
    local label="$2";
    local start=$(date +%s%3N)
    eval "$cmd"
    local end=$(date +%s%3N)
    local dur=$((end-start))
    local size=$(stat -c%s "$3" 2>/dev/null || echo "-")
    printf "$fmt" "$label" "$(stat -c%s "$input")" "$size" "${dur}ms"
}

# roxify
cmd_rox="./target/release/roxify_native compress --level 3"
if [ -n "$dict" ]; then
    cmd_rox="$cmd_rox --dict '$dict'"
fi
cmd_rox="$cmd_rox '$input' '$outfile_rox'"
bench "$cmd_rox" "roxify" "$outfile_rox"

# 7zip (requires 7z in PATH)
cmd_7z="7z a -t7z -mx=3 '$outfile_7z' '$input'"
bench "$cmd_7z" "7zip" "$outfile_7z"

# lz4 (requires lz4 CLI)
cmd_lz4="lz4 -z -1 '$input' '$outfile_lz4'"
bench "$cmd_lz4" "lz4" "$outfile_lz4"



echo "Done benchmarks."