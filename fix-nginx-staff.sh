#!/bin/bash
# Staff manager nginx 추가
sudo sed -i '/location \/center\/fit\//i\
    location /staff/ {\
        proxy_pass http://127.0.0.1:6010/;\
        proxy_http_version 1.1;\
        proxy_set_header Upgrade $http_upgrade;\
        proxy_set_header Connection "upgrade";\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
    }' /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "✅ nginx updated for /staff/"
