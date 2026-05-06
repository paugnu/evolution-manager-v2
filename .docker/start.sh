#!/bin/sh

echo "Starting Scheduled Messages Backend..."
node /app/server/index.js &

echo "Starting Evolution Manager v2 (Nginx)..."

# Start nginx
nginx -g "daemon off;"