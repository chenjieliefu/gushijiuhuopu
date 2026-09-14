"""使用 SQLite online backup，正确包含 WAL 中的已提交数据。"""
import argparse
import sqlite3
from contextlib import closing
from pathlib import Path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error("源数据库不存在")
    if args.destination.exists():
        parser.error("目标已存在，请指定新的备份文件名")
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(args.source.resolve().as_uri() + "?mode=ro", uri=True)) as source:
        with closing(sqlite3.connect(args.destination)) as destination:
            source.backup(destination)
    print(f"Backup saved: {args.destination}")
