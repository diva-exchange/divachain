#!/usr/bin/env bash
#
# Copyright (C) 2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd "${PROJECT_PATH}"
PROJECT_PATH=$(pwd)

esc=$(printf '%q' "$PROJECT_PATH")
pkill -f "$esc/src/main\.ts"

# --- Smart Client HTTP Server Management ---
CLIENT_CMD="deno run --allow-net --allow-read=./src/client jsr:@std/http/file-server ./src/client -p 7272"
# Check if the specific process is running
if pgrep -f "$CLIENT_CMD" > /dev/null; then
    echo "Stopping existing HTTP server..."
    pkill -f "$CLIENT_CMD"
    sleep 1
fi
