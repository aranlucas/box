#!/usr/bin/env bash
# Verifies migrations preserve existing boxes/items/photos (no FK cascade loss) and
# assign them to the legacy Home house. Runs the real migration files in sqlite3 with
# foreign keys ON (D1 always enforces them).
set -euo pipefail
cd "$(dirname "$0")/.."
DB=$(mktemp -t migcheck).db
q() { sqlite3 -cmd "PRAGMA foreign_keys=ON;" "$DB" "$1"; }
sqlite3 -cmd "PRAGMA foreign_keys=ON;" "$DB" < migrations/0001_init.sql
q "INSERT INTO boxes VALUES ('AAAA0001',1,'Kitchen',NULL,NULL,'packed',1,1),('AAAA0002',2,'Books','Office',NULL,'packed',1,1);
   INSERT INTO items VALUES ('I1','AAAA0001','pan',1,'ai',0),('I2','AAAA0001','pot',NULL,'ai',1),('I3','AAAA0002','novel',3,'manual',0);
   INSERT INTO photos VALUES ('P1','AAAA0001','photos/AAAA0001/P1',1),('P2','AAAA0002','photos/AAAA0002/P2',1);"
snap() { q "SELECT (SELECT COUNT(*) FROM boxes)||'|'||(SELECT COUNT(*) FROM items)||'|'||(SELECT COUNT(*) FROM photos)||'|'||(SELECT group_concat(id||':'||number) FROM (SELECT id, number FROM boxes ORDER BY id))"; }
before=$(snap)
for f in migrations/0*.sql; do [ "$f" = migrations/0001_init.sql ] && continue; sqlite3 -cmd "PRAGMA foreign_keys=ON;" "$DB" < "$f"; done
after=$(snap)
echo "before: $before"; echo "after:  $after"
[ "$before" = "$after" ] || { echo "FAIL: data changed"; exit 1; }
other=$(q "SELECT COUNT(*) FROM boxes WHERE house_id IS NOT 'HOME0000'")
[ "$other" = 0 ] || { echo "FAIL: $other boxes not in HOME0000"; exit 1; }
fk=$(q "PRAGMA foreign_key_check")
[ -z "$fk" ] || { echo "FAIL: foreign key violations: $fk"; exit 1; }
# the pre-houses Worker (still live between migrate and deploy) inserts boxes without house_id
q "INSERT INTO boxes (id, number, title, room, status, created_at, updated_at) VALUES ('OLD00001', (SELECT COALESCE(MAX(number), 0) + 1 FROM boxes), 'old worker', NULL, 'packed', 1, 1)" \
  || { echo "FAIL: old Worker insert breaks after migration"; exit 1; }
[ "$(q "SELECT house_id FROM boxes WHERE id='OLD00001'")" = HOME0000 ] || { echo "FAIL: old insert not in Home"; exit 1; }
q "DELETE FROM boxes WHERE id='OLD00001'"
# cascade still works through the renamed tables
q "DELETE FROM boxes WHERE id='AAAA0002'"
left=$(q "SELECT COUNT(*) FROM items WHERE box_id='AAAA0002'")
[ "$left" = 0 ] || { echo "FAIL: cascade broken after rename"; exit 1; }
# per-house numbering: same number allowed in another house, duplicate in same house rejected
q "INSERT INTO houses (id, name, created_at) VALUES ('H2','Garage',1); INSERT INTO boxes (id,number,title,status,created_at,updated_at,house_id) VALUES ('BBBB0001',1,'x','packed',1,1,'H2')"
if q "INSERT INTO boxes (id,number,title,status,created_at,updated_at,house_id) VALUES ('BBBB0002',1,'y','packed',1,1,'H2')" 2>/dev/null; then echo "FAIL: duplicate number in same house"; exit 1; fi
echo "PASS"
