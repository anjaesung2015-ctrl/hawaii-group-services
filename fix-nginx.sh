#!/bin/bash
# nginx 포트 변경 스크립트 — root 또는 sudo로 실행
# 기존 ubuntu PM2 프로세스 → brother PM2로 교체
# fitness:5555→6001, shop:5557→6002, finance:5558→6003, center:5559→6004, lesson:5560→6005

sed -i 's|proxy_pass http://127.0.0.1:5555/|proxy_pass http://127.0.0.1:6001/|g' /etc/nginx/sites-enabled/default
sed -i 's|proxy_pass http://127.0.0.1:5557/|proxy_pass http://127.0.0.1:6002/|g' /etc/nginx/sites-enabled/default
sed -i 's|proxy_pass http://127.0.0.1:5558/|proxy_pass http://127.0.0.1:6003/|g' /etc/nginx/sites-enabled/default
sed -i 's|proxy_pass http://127.0.0.1:5559/|proxy_pass http://127.0.0.1:6004/|g' /etc/nginx/sites-enabled/default
sed -i 's|proxy_pass http://127.0.0.1:5560/|proxy_pass http://127.0.0.1:6005/|g' /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx && echo "✅ nginx 업데이트 완료!" || echo "❌ nginx 오류"
