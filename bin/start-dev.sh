#!/usr/bin/env bash
#
# Copyright (C) 2020 diva.exchange
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

tsc

SECRET=NODE1 HTTP_PORT=17169 P2P_IP=172.20.101.1 P2P_PORT=17168 NODE_ENV=development LOG_LEVEL=trace \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js >>${PROJECT_PATH}log/node1.log 2>&1 &
SECRET=NODE2 HTTP_PORT=17269 P2P_IP=172.20.101.1 P2P_PORT=17268 NODE_ENV=development LOG_LEVEL=trace \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js >>${PROJECT_PATH}log/node2.log 2>&1 &
SECRET=NODE3 HTTP_PORT=17369 P2P_IP=172.20.101.1 P2P_PORT=17368 NODE_ENV=development LOG_LEVEL=trace \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js >>${PROJECT_PATH}log/node3.log 2>&1 &
SECRET=NODE4 HTTP_PORT=17469 P2P_IP=172.20.101.1 P2P_PORT=17468 NODE_ENV=development LOG_LEVEL=trace \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js >>${PROJECT_PATH}log/node4.log 2>&1 &
SECRET=NODE5 HTTP_PORT=17569 P2P_IP=172.20.101.1 P2P_PORT=17568 NODE_ENV=development LOG_LEVEL=trace \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js >>${PROJECT_PATH}log/node5.log 2>&1 &
SECRET=NODE6 HTTP_PORT=17669 P2P_IP=172.20.101.1 P2P_PORT=17668 NODE_ENV=development LOG_LEVEL=trace \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js >>${PROJECT_PATH}log/node6.log 2>&1 &
SECRET=NODE7 HTTP_PORT=17769 P2P_IP=172.20.101.1 P2P_PORT=17768 NODE_ENV=development LOG_LEVEL=trace \
  node --enable-source-maps ${PROJECT_PATH}dist/main.js >>${PROJECT_PATH}log/node7.log 2>&1 &
