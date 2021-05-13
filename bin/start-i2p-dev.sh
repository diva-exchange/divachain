#!/usr/bin/env bash
#
# Copyright (C) 2021 diva.exchange
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
# Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
#
# -e  Exit immediately if a simple command exits with a non-zero status
set -e

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd ${PROJECT_PATH}
PROJECT_PATH=`pwd`/

${PROJECT_PATH}bin/build.sh

SOCKS_PROXY_HOST=172.20.101.101 P2P_IP=127.27.26.201 HTTP_IP=127.27.27.201 NODE_ENV=development \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js | pino-pretty >${PROJECT_PATH}log/node1.log 2>&1 &
SOCKS_PROXY_HOST=172.20.101.102 P2P_IP=127.27.26.202 HTTP_IP=127.27.27.202 NODE_ENV=development \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js | pino-pretty >${PROJECT_PATH}log/node2.log 2>&1 &
SOCKS_PROXY_HOST=172.20.101.103 P2P_IP=127.27.26.203 HTTP_IP=127.27.27.203 NODE_ENV=development \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js | pino-pretty >${PROJECT_PATH}log/node3.log 2>&1 &
SOCKS_PROXY_HOST=172.20.101.104 P2P_IP=127.27.26.204 HTTP_IP=127.27.27.204 NODE_ENV=development \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js | pino-pretty >${PROJECT_PATH}log/node4.log 2>&1 &
SOCKS_PROXY_HOST=172.20.101.105 P2P_IP=127.27.26.205 HTTP_IP=127.27.27.205 NODE_ENV=development \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js | pino-pretty >${PROJECT_PATH}log/node5.log 2>&1 &
SOCKS_PROXY_HOST=172.20.101.106 P2P_IP=127.27.26.206 HTTP_IP=127.27.27.206 NODE_ENV=development \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js | pino-pretty >${PROJECT_PATH}log/node6.log 2>&1 &
SOCKS_PROXY_HOST=172.20.101.107 P2P_IP=127.27.26.207 HTTP_IP=127.27.27.207 NODE_ENV=development \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js | pino-pretty >${PROJECT_PATH}log/node7.log 2>&1 &