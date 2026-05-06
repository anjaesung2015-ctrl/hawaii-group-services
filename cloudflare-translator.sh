#!/bin/bash
exec /usr/local/bin/cloudflared tunnel --url http://localhost:6011 --no-autoupdate --metrics localhost:20242 2>&1
