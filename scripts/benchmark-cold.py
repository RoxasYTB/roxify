#!/usr/bin/env python3

import argparse
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable


@dataclass
class RunMetric:
    run: int
    seconds: float
    throughput_mib_s: float
    source_bytes: int
    result_bytes: int


@dataclass
class BenchSummary:
    label: str
    operation: str
    runs: list[RunMetric]
    min_seconds: float
    median_seconds: float
    mean_seconds: float
    max_seconds: float
    min_throughput_mib_s: float
    median_throughput_mib_s: float
    mean_throughput_mib_s: float
    max_throughput_mib_s: float
    source_bytes: int
    result_bytes: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--roxify-bin", default="/home/yohan/Bureau/_Projets/roxify/target/release/roxify_native")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--results-dir", default="/home/yohan/.roxify-bench-ext4/cold-bench")
    parser.add_argument(
        "--dataset",
        action="append",
        default=[],
        help="label=/abs/path",
    )
    parser.add_argument("--keep-artifacts", action="store_true")
    return parser.parse_args()


def default_datasets() -> list[tuple[str, Path]]:
    return [
        ("glados", Path("/home/yohan/.roxify-bench-ext4/Glados-Disc")),
        ("gmod", Path("/home/yohan/.roxify-bench-ext4/Gmod")),
    ]


def parse_datasets(items: list[str]) -> list[tuple[str, Path]]:
    if not items:
        return default_datasets()
    datasets = []
    for item in items:
        if "=" not in item:
            raise SystemExit(f"Invalid --dataset '{item}', expected label=/abs/path")
        label, raw_path = item.split("=", 1)
        datasets.append((label.strip(), Path(raw_path).expanduser().resolve()))
    return datasets


def iter_files(path: Path) -> Iterable[Path]:
    if path.is_symlink():
        return
    if path.is_file():
        yield path
        return
    for root, _, files in os.walk(path):
        for file_name in files:
            file_path = Path(root) / file_name
            if file_path.is_symlink() or not file_path.is_file():
                continue
            yield file_path


def path_bytes(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for file_path in iter_files(path):
        total += file_path.stat().st_size
    return total


def path_file_count(path: Path) -> int:
    if path.is_file():
        return 1
    return sum(1 for _ in iter_files(path))


def evict_file_pages(path: Path) -> None:
    if not hasattr(os, "posix_fadvise") or not hasattr(os, "POSIX_FADV_DONTNEED"):
        raise RuntimeError("Python os.posix_fadvise(POSIX_FADV_DONTNEED) unavailable")
    if not path.exists() or not path.is_file():
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
    finally:
        os.close(fd)


def evict_path_pages(path: Path) -> None:
    os.sync()
    for file_path in iter_files(path):
        evict_file_pages(file_path)
    os.sync()


def run_command(cmd: list[str]) -> tuple[float, subprocess.CompletedProcess[str]]:
    start = time.perf_counter_ns()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = (time.perf_counter_ns() - start) / 1_000_000_000
    return elapsed, proc


def summarize(label: str, operation: str, runs: list[RunMetric]) -> BenchSummary:
    seconds = [run.seconds for run in runs]
    throughput = [run.throughput_mib_s for run in runs]
    return BenchSummary(
        label=label,
        operation=operation,
        runs=runs,
        min_seconds=min(seconds),
        median_seconds=statistics.median(seconds),
        mean_seconds=statistics.fmean(seconds),
        max_seconds=max(seconds),
        min_throughput_mib_s=min(throughput),
        median_throughput_mib_s=statistics.median(throughput),
        mean_throughput_mib_s=statistics.fmean(throughput),
        max_throughput_mib_s=max(throughput),
        source_bytes=runs[0].source_bytes,
        result_bytes=runs[-1].result_bytes,
    )


def format_bytes(value: int) -> str:
    if value <= 0:
        return "0 B"
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    size = float(value)
    unit_index = 0
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    return f"{size:.2f} {units[unit_index]}"


def throughput_mib(source_bytes: int, seconds: float) -> float:
    if seconds <= 0:
        return math.inf
    return source_bytes / (1024 * 1024) / seconds


def bench_dataset(
    roxify_bin: Path,
    label: str,
    dataset_path: Path,
    runs: int,
    results_dir: Path,
    keep_artifacts: bool,
) -> tuple[BenchSummary, BenchSummary]:
    source_bytes = path_bytes(dataset_path)
    encode_runs: list[RunMetric] = []
    decode_runs: list[RunMetric] = []

    for run_index in range(1, runs + 1):
        png_path = results_dir / f"{label}.cold.run{run_index}.png"
        decode_dir = results_dir / f"{label}.cold.run{run_index}.out"

        if png_path.exists():
            png_path.unlink()
        if decode_dir.exists():
            shutil.rmtree(decode_dir)

        evict_path_pages(dataset_path)
        encode_seconds, encode_proc = run_command([
            str(roxify_bin),
            "encode",
            str(dataset_path),
            str(png_path),
        ])
        if encode_proc.returncode != 0:
            raise RuntimeError(
                f"Encode failed for {label} run {run_index}:\nSTDOUT:\n{encode_proc.stdout}\nSTDERR:\n{encode_proc.stderr}"
            )
        png_bytes = png_path.stat().st_size
        encode_runs.append(
            RunMetric(
                run=run_index,
                seconds=encode_seconds,
                throughput_mib_s=throughput_mib(source_bytes, encode_seconds),
                source_bytes=source_bytes,
                result_bytes=png_bytes,
            )
        )

        evict_path_pages(png_path)
        decode_seconds, decode_proc = run_command([
            str(roxify_bin),
            "decompress",
            str(png_path),
            str(decode_dir),
        ])
        if decode_proc.returncode != 0:
            raise RuntimeError(
                f"Decode failed for {label} run {run_index}:\nSTDOUT:\n{decode_proc.stdout}\nSTDERR:\n{decode_proc.stderr}"
            )

        decoded_bytes = path_bytes(decode_dir)
        if decoded_bytes != source_bytes:
            raise RuntimeError(
                f"Decoded bytes mismatch for {label} run {run_index}: expected {source_bytes}, got {decoded_bytes}"
            )
        decode_runs.append(
            RunMetric(
                run=run_index,
                seconds=decode_seconds,
                throughput_mib_s=throughput_mib(source_bytes, decode_seconds),
                source_bytes=source_bytes,
                result_bytes=decoded_bytes,
            )
        )

        print(
            f"[{label}] run {run_index}: encode {encode_seconds:.3f}s {encode_runs[-1].throughput_mib_s:.2f} MiB/s | "
            f"decode {decode_seconds:.3f}s {decode_runs[-1].throughput_mib_s:.2f} MiB/s"
        )

        if not keep_artifacts:
            if png_path.exists():
                png_path.unlink()
            if decode_dir.exists():
                shutil.rmtree(decode_dir)

    return summarize(label, "encode", encode_runs), summarize(label, "decode", decode_runs)


def print_summary(summary: BenchSummary) -> None:
    print(
        f"{summary.label:12} {summary.operation:7} "
        f"src={format_bytes(summary.source_bytes):>10} "
        f"res={format_bytes(summary.result_bytes):>10} "
        f"median={summary.median_seconds:8.3f}s "
        f"mean={summary.mean_seconds:8.3f}s "
        f"thr_med={summary.median_throughput_mib_s:8.2f} MiB/s "
        f"thr_mean={summary.mean_throughput_mib_s:8.2f} MiB/s"
    )


def main() -> int:
    args = parse_args()
    roxify_bin = Path(args.roxify_bin).expanduser().resolve()
    if not roxify_bin.exists():
        raise SystemExit(f"Missing roxify binary: {roxify_bin}")

    datasets = parse_datasets(args.dataset)
    results_dir = Path(args.results_dir).expanduser().resolve() / time.strftime("%Y%m%d-%H%M%S")
    results_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, object] = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "roxify_bin": str(roxify_bin),
        "cold_method": "os.posix_fadvise(POSIX_FADV_DONTNEED)",
        "runs": args.runs,
        "datasets": [],
    }

    print(f"cold method: {manifest['cold_method']}")
    print(f"roxify: {roxify_bin}")
    print(f"results: {results_dir}")
    print()

    for label, dataset_path in datasets:
        dataset_path = dataset_path.resolve()
        if not dataset_path.exists():
            raise SystemExit(f"Missing dataset: {dataset_path}")

        print(f"dataset {label}: {dataset_path}")
        print(f"files={path_file_count(dataset_path)} bytes={path_bytes(dataset_path)}")
        encode_summary, decode_summary = bench_dataset(
            roxify_bin=roxify_bin,
            label=label,
            dataset_path=dataset_path,
            runs=args.runs,
            results_dir=results_dir,
            keep_artifacts=args.keep_artifacts,
        )
        print_summary(encode_summary)
        print_summary(decode_summary)
        print()
        manifest["datasets"].append(
            {
                "label": label,
                "path": str(dataset_path),
                "encode": asdict(encode_summary),
                "decode": asdict(decode_summary),
            }
        )

    manifest_path = results_dir / "summary.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"json: {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())