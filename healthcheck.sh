#!/bin/bash
export PATH="/home/ubuntu/.npm-global/bin:$PATH"

PORTS=(6001 6002 6003 6004 6005 6006 6007 6008 6009)
NAMES=("fitness-crm" "shop-manager" "finance-manager" "center-manager" "lesson-manager" "touring-manager" "schedule-manager" "vocab-trainer" "fitness-trainer")

DEAD=0
for i in "${!PORTS[@]}"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:${PORTS[$i]} 2>/dev/null)
  if [ "$CODE" != "200" ]; then
    echo "$(date): ${NAMES[$i]}(${PORTS[$i]}) DOWN - 복구 시도"
    pm2 restart ${NAMES[$i]} 2>/dev/null
    DEAD=$((DEAD+1))
  fi
done

# PM2 자체가 죽었으면 ecosystem으로 전체 복구
PM2_COUNT=$(pm2 list 2>/dev/null | grep -c "online")
if [ "$PM2_COUNT" -lt 5 ]; then
  echo "$(date): PM2 프로세스 부족($PM2_COUNT) - 전체 복구"
  cd /home/brother/.openclaw/workspace
  pm2 start ecosystem.config.js 2>/dev/null
  pm2 save 2>/dev/null
fi
