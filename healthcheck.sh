#!/bin/sh
# Restarts Commons if it stops answering (crashed, frozen, or stuck).
# Run every minute from cron:  * * * * * /root/JustaTest/healthcheck.sh
PORT="${PORT:-8080}"
if ! curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" > /dev/null; then
  echo "$(date) health check failed, restarting" >> "$(dirname "$0")/health.log"
  systemctl restart commons
fi
