#!/bin/bash
# 어머니 송금 리마인더 - 매월 28일 실행
MONTH=$(date +%m)
curl -s -X POST "http://localhost:18791/api/message" \
  -H "Authorization: Bearer brother-openclaw-token-2026" \
  -H "Content-Type: application/json" \
  -d "{\"target\":\"8171404664\",\"message\":\"💝 재성님, 이번 달 말 어머니 송금 리마인더!\\n\\n₮5,000,000 송금 잊지 마세요! 🙏\",\"channel\":\"telegram\"}" 2>/dev/null
