#!/bin/bash
# 아침 브리핑 스크립트
TOKEN="brother-openclaw-token-2026"
PORT=18791

curl -s -X POST "http://localhost:$PORT/api/v1/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"아침 브리핑 시간입니다. 오늘의 스케줄을 확인하고 재성님에게 텔레그램으로 보내주세요. schedule-manager DB에서 오늘 일정 조회 + 요일별 고정 스케줄 안내 + 이동 동선 포함.\"}" 2>/dev/null
