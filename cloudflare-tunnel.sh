#!/bin/bash
exec /usr/local/bin/cloudflared tunnel --url http://localhost:6004 --no-autoupdate 2>&1
