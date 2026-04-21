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

echo
echo "Creating single development node in ${PROJECT_PATH}/test/data/dev/dev0000000/"
echo
echo "IMPORTANT: set the BOOTSTRAP env variable within this file correctly!"
echo "Example, a b32 address of one of your local nodes, like:"
echo "  naylobaesowecuyzcaayunsh4acr4aibdmtlfmowq6hue57uemtq.b32.i2p"
echo
echo "b32 addresses are found within your log files of your development network."
echo "SEE README!"

rm -rf ${PROJECT_PATH}/test/data/dev/dev0000000

GENESIS=1 \
  IS_TESTNET=1 \
  BOOTSTRAP=YOUR_LOCAL_I2P_NODE_HERE.b32.i2p \
  NAME_NODE=dev \
  IP=0.0.0.0 \
  PORT=19468 \
  PORT_TX_FEED=19469 \
  I2P_SOCKS=172.19.75.11:4445 \
  I2P_SAM_HTTP=172.19.75.11:7656 \
  I2P_SAM_FORWARD_HTTP=172.19.75.1:19468 \
  I2P_SAM_UDP=172.19.75.12:7656 \
  I2P_SAM_LISTEN_UDP=172.19.75.1:19470 \
  I2P_SAM_FORWARD_UDP=172.19.75.1:19470 \
  deno run --allow-all ./src/main.ts

echo "Done. API: http://localhost:19468"
echo
