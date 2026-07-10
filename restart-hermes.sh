#!/usr/bin/env bash
set -euo pipefail

DBUS="unix:path=/run/user/$(id -u)/bus"

for svc in hermes-agent.service hermes-gateway.service hermes-dashboard.service hermes-webui.service; do
  echo "Restarting $svc ..."
  DBUS_SESSION_BUS_ADDRESS="$DBUS" systemctl --user restart "$svc"
done

echo "Done."
