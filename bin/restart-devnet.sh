#!/usr/bin/env bash
#
# Copyright (C) 2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#
set -e

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd "${PROJECT_PATH}"
PROJECT_PATH=$(pwd)

source ${PROJECT_PATH}/bin/stop-devnet.sh
source ${PROJECT_PATH}/bin/start-devnet.sh

