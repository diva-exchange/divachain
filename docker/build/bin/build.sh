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

# make sure that the docker container are using the latest image version
sudo ${PROJECT_PATH}../../bin/build-docker.sh

${PROJECT_PATH}bin/clean.sh

# reasonable defaults
SIZE_NETWORK=${SIZE_NETWORK:-7}
IS_NAME_BASED=${IS_NAME_BASED:-0}
BASE_DOMAIN=${BASE_DOMAIN:-testnet.diva.i2p}
BASE_IP=${BASE_IP:-172.20.72.}
PORT_P2P=${PORT_P2P:-17468}
HAS_I2P=${HAS_I2P:-0}
NODE_ENV=${NODE_ENV:-production}
NETWORK_SYNC_THRESHOLD=${NETWORK_SYNC_THRESHOLD:-2}
NETWORK_VERBOSE_LOGGING=${NETWORK_VERBOSE_LOGGING:-0}

if [[ ${HAS_I2P} > 0 ]]
then
  SIZE_NETWORK=${SIZE_NETWORK} \
    BASE_DOMAIN=${BASE_DOMAIN} \
    BASE_IP=${BASE_IP} \
    PORT_P2P=${PORT_P2P} \
    CREATE_I2P=1 \
    ts-node ${PROJECT_PATH}main.ts

  sudo docker-compose -f ${PROJECT_PATH}i2p-testnet.yml up -d

  rm -rf ${PROJECT_PATH}i2p-b32.lst
  for (( t=1; t<=${SIZE_NETWORK}; t++ ))
  do
    sleep 2
    IP=${BASE_IP}$((50 + t))
    echo http://${IP}:7070
    curl -s http://${IP}:7070/?page=i2p_tunnels | \
      grep -Po "[a-z2-7]+\.b32\.i2p\:${PORT_P2P}" 2>&1 \
      >${PROJECT_PATH}i2p-b32/n${t}.${BASE_DOMAIN}
  done

  sudo docker-compose -f ${PROJECT_PATH}i2p-testnet.yml down

  rm -rf ${PROJECT_PATH}i2p-testnet.yml
fi

SIZE_NETWORK=${SIZE_NETWORK} \
  IS_NAME_BASED=${IS_NAME_BASED} \
  BASE_DOMAIN=${BASE_DOMAIN} \
  BASE_IP=${BASE_IP} \
  PORT_P2P=${PORT_P2P} \
  HAS_I2P=${HAS_I2P} \
  NODE_ENV=${NODE_ENV} \
  NETWORK_SYNC_THRESHOLD=${NETWORK_SYNC_THRESHOLD} \
  NETWORK_VERBOSE_LOGGING=${NETWORK_VERBOSE_LOGGING} \
  ts-node ${PROJECT_PATH}main.ts
