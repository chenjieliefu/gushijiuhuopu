"""Restore into a NEW database path; never overwrite the live database."""
import argparse
import sqlite3
from pathlib import Path

if __package__:
    from .backup import backup_database
else:
    from backup import backup_database


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('new_database', type=Path)
    args = parser.parse_args()
    try:
        backup_database(args.backup, args.new_database)
    except (ValueError, OSError, sqlite3.Error) as exc:
        parser.error(str(exc))
    print(f'Restore verified: {args.new_database}')
    print('停止服务后，将 DATABASE_PATH 指向新文件再启动；原数据库未覆盖。')
