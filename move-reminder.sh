#!/bin/bash
# 이동 알림 스크립트
TOKEN="brother-openclaw-token-2026"
PORT=18791
MSG="$1"

curl -s -X POST "http://localhost:$PORT/api/v1/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"재성님에게 이동 알림을 보내주세요: $MSG\"}" 2>/dev/null
