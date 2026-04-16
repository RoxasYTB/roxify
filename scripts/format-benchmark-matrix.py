#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", action="append", required=True)
    return parser.parse_args()


def fmt_bytes(value: int) -> str:
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    size = float(value)
    idx = 0
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024.0
        idx += 1
    return f"{size:.2f} {units[idx]}"


def fmt_time(seconds: float) -> str:
    minutes = int(seconds // 60)
    remain = seconds - minutes * 60
    if minutes > 0:
        return f"{minutes} min {remain:05.2f} s"
    return f"{remain:.2f} s"


def fmt_thr(value: float) -> str:
    return f"{value:.2f} MiB/s"


def fmt_pct(value: float) -> str:
    return f"{value:.2f}%"


def load_rows(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["datasets"]


def make_table(rows: list[dict], fmt_key: str) -> str:
    lines = [
        "| Dataset | Files | Source | Format | Final size | Saved | Encode | Encode throughput | Decode | Decode throughput |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        for format_name, display_name in (("roxify", "PNG (Roxify)"), ("zip", "ZIP")):
            fmt = row[format_name]
            lines.append(
                "| {dataset} | {files:,} | {source} | {fmt_name} | {archive} | {saved} | {enc} | {enc_thr} | {dec} | {dec_thr} |".format(
                    dataset=row["label"],
                    files=row["files"],
                    source=fmt_bytes(row["source_bytes"]),
                    fmt_name=display_name,
                    archive=fmt_bytes(fmt["archive_bytes"]),
                    saved=fmt_pct(fmt["saved_pct"]),
                    enc=fmt_time(fmt["encode_seconds"]),
                    enc_thr=fmt_thr(fmt["encode_throughput_mib_s"]),
                    dec=fmt_time(fmt["decode_seconds"]),
                    dec_thr=fmt_thr(fmt["decode_throughput_mib_s"]),
                )
            )
    header = "### {}\n".format(fmt_key)
    return header + "\n".join(lines)


def main() -> int:
    args = parse_args()
    by_fs: dict[str, list[dict]] = {}
    for raw_path in args.summary:
        path = Path(raw_path).expanduser().resolve()
        rows = load_rows(path)
        if not rows:
            continue
        fs = rows[0]["fs"]
        by_fs.setdefault(fs, []).extend(rows)

    sections = []
    for fs in sorted(by_fs):
        sections.append(make_table(by_fs[fs], f"{fs.upper()}"))

    print("\n\n".join(sections))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())