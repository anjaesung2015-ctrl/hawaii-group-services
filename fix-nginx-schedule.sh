#!/bin/bash
# Add schedule-manager + touring-manager to nginx
# Check if touring already exists
if ! grep -q "location /touring/" /etc/nginx/sites-enabled/default; then
  sudo sed -i '/location \/my-lesson\//i\
    location /touring/ {\
        proxy_pass http://127.0.0.1:6006/;\
        proxy_http_version 1.1;\
        proxy_set_header Upgrade $http_upgrade;\
        proxy_set_header Connection "upgrade";\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
    }' /etc/nginx/sites-enabled/default
  echo "✅ touring added"
fi

if ! grep -q "location /schedule/" /etc/nginx/sites-enabled/default; then
  sudo sed -i '/location \/my-lesson\//i\
    location /schedule/ {\
        proxy_pass http://127.0.0.1:6007/;\
        proxy_http_version 1.1;\
        proxy_set_header Upgrade $http_upgrade;\
        proxy_set_header Connection "upgrade";\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
    }' /etc/nginx/sites-enabled/default
  echo "✅ schedule added"
fi

sudo nginx -t && sudo systemctl reload nginx
echo ""
echo "✅ Done!"
echo "  https://hawaiigroup.co/touring/"
echo "  https://hawaiigroup.co/schedule/"
