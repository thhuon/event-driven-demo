#!/usr/bin/env bash
# Đăng ký nhanh N user (mặc định 20) cùng lúc, để xem nhiều bản email-service chia tải.
# Dùng: ./scripts/register-many.sh [N]
set -euo pipefail

N=${1:-20}
API=${API:-http://localhost:4003/api/users}
RUN=$(date +%s)

for i in $(seq 1 "$N"); do
  curl -s -o /dev/null -w "%{http_code} " -X POST "$API" \
    -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"Load User $i\",\"email\":\"load$i-$RUN@example.com\",\"gender\":\"other\"}" &
done
wait
echo
