#!/bin/bash
exec /usr/local/bin/cloudflared tunnel --url http://localhost:6030 --no-autoupdate 2>&1
