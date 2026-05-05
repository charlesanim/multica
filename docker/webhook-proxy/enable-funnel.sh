#!/bin/sh
# Wait for Tailscale to be fully up before enabling Funnel
echo "Waiting for Tailscale to come online..."
while ! tailscale status >/dev/null 2>&1; do
  sleep 2
done
echo "Tailscale is online. Enabling Funnel on port 8443..."
sleep 3
tailscale funnel --bg --https=8443 http://127.0.0.1:4901
echo "Funnel enabled."
