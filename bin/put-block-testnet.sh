#!/usr/bin/env bash
#
# Copyright (C) 2025-2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#
set -e

if [ "$#" -lt 1 ]; then
  echo "Error: Too few arguments."
  echo "Usage: $0 <number of PUTs> [interval in seconds] [jitter e.g. 0.2 for 20%]"
  echo "Example: $0 10 5 0.2"
  exit 1
fi

NUM_PUTS=$1
INTERVAL=${2:-0}
JITTER=${3:-0}

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd "${PROJECT_PATH}"
PROJECT_PATH=$(pwd)

echo "Starting ${NUM_PUTS} PUT requests..."

for (( i=1; i<=NUM_PUTS; i++ )); do
  L=$(( (RANDOM % 7901) + 100 )) 
  RANDOM_STRING=$(tr -dc 'A-Za-z0-9!_\{\}\[\]-' < /dev/urandom | head -c "$L")
  PORT=$(( 17468 + ((RANDOM % 64) * 10) ))

  TOKEN=$(curl -s http://localhost:$PORT/testnet/token | jq -r '.token')
  
  echo "[$i/$NUM_PUTS] diva-token-api: $TOKEN"

  # -f (fail silently internally) removed so you can see HTTP errors, or keep as is to just see the log output.
  curl -s \
    'http://localhost:'$PORT'/block/' \
    -X PUT \
    -H "diva-token-api: $TOKEN" \
    --data-raw '[{"c":"data","ns":"test:data","d":"'$RANDOM_STRING'"}]' > /dev/null

  echo "[$i/$NUM_PUTS] Done PUT ${#RANDOM_STRING} bytes to port ${PORT}"

  if [ "$i" -lt "$NUM_PUTS" ]; then
    DO_SLEEP=$(awk -v i="$INTERVAL" 'BEGIN { print (i > 0) ? 1 : 0 }')
    
    if [ "$DO_SLEEP" -eq 1 ]; then
      # FIX: Changed 'rand' to 'rval' to avoid keyword collision in awk
      SLEEP_TIME=$(awk -v base="$INTERVAL" -v jitter="$JITTER" -v rval="$RANDOM" '
        BEGIN {
          if (jitter > 0) {
            factor = (rval / 32767.0) * 2.0 - 1.0;
            calc = base + (base * jitter * factor);
            if (calc < 0) calc = 0;
            printf "%.3f", calc;
          } else {
            printf "%.3f", base;
          }
        }
      ')
      echo "Sleeping for ${SLEEP_TIME} seconds before the next request..."
      sleep "$SLEEP_TIME"
    fi
  fi
done

echo "All ${NUM_PUTS} PUT requests finished."