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

IN_LOG_DIR="${PROJECT_PATH}/data/dev"
OUT_DIR="${PROJECT_PATH}/log"
OUT_FILE="${OUT_DIR}/ai-digest.txt"

mkdir -p "${OUT_DIR}"
echo "Create log-digest for AI analysis..."

extract_and_sort() {
    local pattern=$1
    local lines=$2
    grep -E "$pattern" $IN_LOG_DIR/n*/log/diva.log 2>/dev/null | \
    sed -E 's/.*(n[0-9]{7})\/log\/diva\.log:(.*)/\2 [\1]/' | \
    sort | tail -n "$lines"
}

echo "=== 1. CRITICAL & WARNINGS (Last 30) ===" > $OUT_FILE
# Pino logs use numeric levels: 40 (WARN), 50 (ERROR), 60 (FATAL)
extract_and_sort "\"level\":[456]0" 30 >> $OUT_FILE

echo -e "\n=== 2. EPOCH TRANSITIONS (Last 15) ===" >> $OUT_FILE
extract_and_sort "Event-Clock reached K=" 15 >> $OUT_FILE

echo -e "\n=== 3. DECOY GENERATION (Last 20) ===" >> $OUT_FILE
# Added the specific failure message so it tracks decoy aborts directly
extract_and_sort "Generating decoy block for SOC|Latest SocBlock on local chain not available" 20 >> $OUT_FILE

echo -e "\n=== 4. SOC SYNC PULLS (Last 20) ===" >> $OUT_FILE
extract_and_sort "SOC pull failed" 20 >> $OUT_FILE

echo -e "\n=== 5. SUCCESSFUL STORAGE (Last 20) ===" >> $OUT_FILE
extract_and_sort "Stored local SOC block" 20 >> $OUT_FILE

echo -e "\n=== 6. NETWORK TELEMETRY (Last 30) ===" >> $OUT_FILE
# Capture the new telemetry output showing UDP/HTTP network pressure
extract_and_sort "\[TELEMETRY\]" 30 >> $OUT_FILE

echo "Digest created as $OUT_FILE."