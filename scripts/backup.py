"""SQLite online backup with validation and an exclusive, private destination."""
import argparse
import os
import sqlite3
from contextlib import closing
from pathlib import Path


def backup_database(source: Path, destination: Path):
    if not source.is_file():
        raise ValueError('源数据库不存在')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite an existing backup, even when two callers race.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as src:
            tables = {row[0] for row in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {'sessions','requests'} <= tables:
                raise ValueError('不是故事旧货铺会话数据库')
            with closing(sqlite3.connect(destination)) as dst:
                src.backup(dst)
                if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('备份完整性检查失败')
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    try:
        backup_database(args.source, args.destination)
    except (ValueError, OSError, sqlite3.Error) as exc:
        parser.error(str(exc))
    print(f'Backup verified: {args.destination}')
