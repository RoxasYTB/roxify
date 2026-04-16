#!/usr/bin/env python3

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class FormatBench:
    archive_bytes: int
    saved_pct: float
    encode_seconds: float
    encode_throughput_mib_s: float
    decode_seconds: float
    decode_throughput_mib_s: float


@dataclass
class DatasetBench:
    label: str
    fs: str
    path: str
    files: int
    source_bytes: int
    roxify: FormatBench
    zip: FormatBench


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--roxify-bin", required=True)
    parser.add_argument("--results-dir", required=True)
    parser.add_argument(
        "--dataset",
        action="append",
        default=[],
        help="label|fs=/abs/path",
    )
    parser.add_argument("--keep-artifacts", action="store_true")
    return parser.parse_args()


def parse_datasets(items: list[str]) -> list[tuple[str, str, Path]]:
    if not items:
        raise SystemExit("At least one --dataset label|fs=/abs/path is required")
    datasets = []
    for item in items:
        if "=" not in item or "|" not in item.split("=", 1)[0]:
            raise SystemExit(f"Invalid --dataset '{item}', expected label|fs=/abs/path")
        lhs, raw_path = item.split("=", 1)
        label, fs_name = lhs.split("|", 1)
        datasets.append((label.strip(), fs_name.strip(), Path(raw_path).expanduser().resolve()))
    return datasets


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "item"


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
        return
    if not path.exists() or not path.is_file():
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
    finally:
        os.close(fd)


def evict_path_pages(path: Path) -> None:
    os.sync()
    if path.is_file():
        evict_file_pages(path)
        os.sync()
        return
    for file_path in iter_files(path):
        evict_file_pages(file_path)
    os.sync()


def run_command(cmd: list[str], cwd: Path | None = None) -> float:
    start = time.perf_counter_ns()
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    elapsed = (time.perf_counter_ns() - start) / 1_000_000_000
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\nSTDERR:\n{proc.stderr}"
        )
    return elapsed


def throughput_mib(source_bytes: int, seconds: float) -> float:
    if seconds <= 0:
        return math.inf
    return source_bytes / (1024 * 1024) / seconds


def saved_pct(source_bytes: int, archive_bytes: int) -> float:
    if source_bytes <= 0:
        return 0.0
    return 100.0 - ((archive_bytes / source_bytes) * 100.0)


def bench_roxify(
    roxify_bin: Path,
    dataset_path: Path,
    archive_path: Path,
    decode_dir: Path,
) -> FormatBench:
    if archive_path.exists():
        archive_path.unlink()
    if decode_dir.exists():
        shutil.rmtree(decode_dir)

    source_bytes = path_bytes(dataset_path)

    evict_path_pages(dataset_path)
    encode_seconds = run_command([
        str(roxify_bin),
        "encode",
        str(dataset_path),
        str(archive_path),
    ])
    archive_bytes = archive_path.stat().st_size

    evict_path_pages(archive_path)
    decode_seconds = run_command([
        str(roxify_bin),
        "decompress",
        str(archive_path),
        str(decode_dir),
    ])

    decoded_bytes = path_bytes(decode_dir)
    if decoded_bytes != source_bytes:
        raise RuntimeError(
            f"Roxify decoded bytes mismatch for {dataset_path}: expected {source_bytes}, got {decoded_bytes}"
        )

    return FormatBench(
        archive_bytes=archive_bytes,
        saved_pct=saved_pct(source_bytes, archive_bytes),
        encode_seconds=encode_seconds,
        encode_throughput_mib_s=throughput_mib(source_bytes, encode_seconds),
        decode_seconds=decode_seconds,
        decode_throughput_mib_s=throughput_mib(source_bytes, decode_seconds),
    )


def bench_zip(dataset_path: Path, archive_path: Path, decode_dir: Path) -> FormatBench:
    if archive_path.exists():
        archive_path.unlink()
    if decode_dir.exists():
        shutil.rmtree(decode_dir)

    source_bytes = path_bytes(dataset_path)
    parent = dataset_path.parent
    target_name = dataset_path.name

    evict_path_pages(dataset_path)
    encode_seconds = run_command([
        "zip",
        "-qry",
        str(archive_path),
        target_name,
    ], cwd=parent)
    archive_bytes = archive_path.stat().st_size

    evict_path_pages(archive_path)
    decode_dir.mkdir(parents=True, exist_ok=True)
    decode_seconds = run_command([
        "unzip",
        "-qq",
        str(archive_path),
        "-d",
        str(decode_dir),
    ])

    decoded_bytes = path_bytes(decode_dir)
    if decoded_bytes != source_bytes:
        raise RuntimeError(
            f"ZIP decoded bytes mismatch for {dataset_path}: expected {source_bytes}, got {decoded_bytes}"
        )

    return FormatBench(
        archive_bytes=archive_bytes,
        saved_pct=saved_pct(source_bytes, archive_bytes),
        encode_seconds=encode_seconds,
        encode_throughput_mib_s=throughput_mib(source_bytes, encode_seconds),
        decode_seconds=decode_seconds,
        decode_throughput_mib_s=throughput_mib(source_bytes, decode_seconds),
    )


def main() -> int:
    args = parse_args()
    roxify_bin = Path(args.roxify_bin).expanduser().resolve()
    if not roxify_bin.exists():
        raise SystemExit(f"Missing roxify binary: {roxify_bin}")

    results_dir = Path(args.results_dir).expanduser().resolve()
    results_dir.mkdir(parents=True, exist_ok=True)

    datasets = parse_datasets(args.dataset)
    manifest: dict[str, object] = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "roxify_bin": str(roxify_bin),
        "zip_command": ["zip", "-qry"],
        "unzip_command": ["unzip", "-qq"],
        "cold_method": "os.posix_fadvise(POSIX_FADV_DONTNEED)",
        "datasets": [],
    }

    for label, fs_name, dataset_path in datasets:
        if not dataset_path.exists():
            raise SystemExit(f"Missing dataset: {dataset_path}")

        dataset_slug = slug(label)
        fs_slug = slug(fs_name)
        work_dir = results_dir / fs_slug / dataset_slug
        work_dir.mkdir(parents=True, exist_ok=True)

        source_bytes = path_bytes(dataset_path)
        file_count = path_file_count(dataset_path)
        print(f"[{fs_name}] {label}: files={file_count} bytes={source_bytes}", flush=True)

        rox_archive = work_dir / f"{dataset_slug}.png"
        rox_decode = work_dir / "roxify.out"
        roxify_result = bench_roxify(roxify_bin, dataset_path, rox_archive, rox_decode)
        print(
            f"  roxify: encode {roxify_result.encode_seconds:.3f}s decode {roxify_result.decode_seconds:.3f}s "
            f"archive={roxify_result.archive_bytes}",
            flush=True,
        )

        zip_archive = work_dir / f"{dataset_slug}.zip"
        zip_decode = work_dir / "zip.out"
        zip_result = bench_zip(dataset_path, zip_archive, zip_decode)
        print(
            f"  zip:    encode {zip_result.encode_seconds:.3f}s decode {zip_result.decode_seconds:.3f}s "
            f"archive={zip_result.archive_bytes}",
            flush=True,
        )

        if not args.keep_artifacts:
            if rox_archive.exists():
                rox_archive.unlink()
            if zip_archive.exists():
                zip_archive.unlink()
            if rox_decode.exists():
                shutil.rmtree(rox_decode)
            if zip_decode.exists():
                shutil.rmtree(zip_decode)

        manifest["datasets"].append(
            asdict(
                DatasetBench(
                    label=label,
                    fs=fs_name,
                    path=str(dataset_path),
                    files=file_count,
                    source_bytes=source_bytes,
                    roxify=roxify_result,
                    zip=zip_result,
                )
            )
        )

    manifest_path = results_dir / "summary.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"json: {manifest_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())