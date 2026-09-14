"""Preview expired sessions; --apply deletes them and their replay snapshots."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.limits import Limits
from app.store import Store


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--vacuum', action='store_true', help='仅用于停止服务后的磁盘回收，需同时 --apply')
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error('数据库不存在')
    if args.vacuum and not args.apply:
        parser.error('--vacuum 需同时 --apply，且必须先停止服务')
    store = Store(args.database, limits=Limits.from_env())
    # Existing databases must first be started by the upgraded service to establish
    # activity timestamps. A dry-run must not silently create migration records.
    with store.connection() as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='session_activity'").fetchone():
            parser.error('请先用新版服务启动一次，以建立旧会话的保留期起点')
    result = store.cleanup(dry_run=not args.apply)
    if args.vacuum:
        with store.connection() as db:
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            db.execute('VACUUM')
    print(json.dumps(result, ensure_ascii=False))
