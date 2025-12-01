#!/usr/bin/env bash
#
# Copyright (C) 2025 diva.exchange
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#
# -e  Exit immediately if a simple command exits with a non-zero status
set -e

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd "${PROJECT_PATH}"
PROJECT_PATH=$(pwd)

# sudo docker compose "${PROJECT_PATH}"/local-i2p-testnet.yml down
# sudo docker compose "${PROJECT_PATH}"/local-i2p-testnet.yml up -d

echo
echo "Creating development nodes in ${PROJECT_PATH}/data/dev/"
echo

GENESIS=1 \
  IS_TESTNET=1 \
  IP=0.0.0.0 \
  PORT=17468 \
  PORT_TX_FEED=17469 \
  I2P_SOCKS=172.19.75.11:4445 \
  I2P_SAM_HTTP=172.19.75.11:7656 \
  I2P_SAM_FORWARD_HTTP=172.19.75.1:17468 \
  I2P_SAM_UDP=172.19.75.12:7656 \
  I2P_SAM_LISTEN_UDP=172.19.75.1:17470 \
  I2P_SAM_FORWARD_UDP=172.19.75.1:17470 \
  deno run --allow-all ./src/main.ts >/dev/null