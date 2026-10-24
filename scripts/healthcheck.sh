#!/bin/bash
# Checks that the backend is up. Use with cron or an uptime monitor.
#   scripts/healthcheck.sh https://api.yourdomain.co.ke        (exit 0 = healthy, 1 = problem)
URL="${1:-http://localhost:3000}"
OUT=$(curl -fsS -m 10 "$URL/api/kitchens/health") || { echo "DOWN: no answer from $URL"; exit 1; }
echo "$OUT" | grep -q '"ok":true' && { echo "OK $OUT"; exit 0; }
echo "PROBLEM $OUT"; exit 1
