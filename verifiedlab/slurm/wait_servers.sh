#!/bin/bash
# Poll every server in slurm/endpoints.json until /health answers (or timeout, default 20 min).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMEOUT=${1:-1200}; t=0
"${VL_ENV:+$VL_ENV/bin/}python" - "$ROOT/slurm/endpoints.json" "$TIMEOUT" <<'PYEOF'
import json,sys,time,urllib.request
servers=json.load(open(sys.argv[1]))["servers"]; limit=int(sys.argv[2]); t0=time.time(); up=set()
while time.time()-t0<limit and len(up)<len(servers):
    for s in servers:
        if s["name"] in up: continue
        try:
            urllib.request.urlopen(s["url"].replace("/v1","/health"),timeout=2); up.add(s["name"]); print(f"UP   {s['name']:16s} {s['url']}  ({time.time()-t0:.0f}s)",flush=True)
        except Exception: pass
    time.sleep(5)
down=[s["name"] for s in servers if s["name"] not in up]
print("all servers up" if not down else f"NOT UP after {limit}s: {down}")
sys.exit(1 if down else 0)
PYEOF
