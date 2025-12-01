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
echo "Starting six development nodes, n1 to n6, in"
echo "${PROJECT_PATH}/test/data/dev/"
echo
echo "Start node n0 manually to develop: deno task dev-n0"
echo
echo "Logs are found, as for node n1, in test/data/dev/n0000001/log/diva.log"
echo

PATH_CONFIG=test/data/dev/n0000001/config.json deno run --allow-all ${PROJECT_PATH}/src/main.ts &>/dev/null & disown;
PATH_CONFIG=test/data/dev/n0000002/config.json deno run --allow-all ${PROJECT_PATH}/src/main.ts &>/dev/null & disown;
PATH_CONFIG=test/data/dev/n0000003/config.json deno run --allow-all ${PROJECT_PATH}/src/main.ts &>/dev/null & disown;
PATH_CONFIG=test/data/dev/n0000004/config.json deno run --allow-all ${PROJECT_PATH}/src/main.ts &>/dev/null & disown;
PATH_CONFIG=test/data/dev/n0000005/config.json deno run --allow-all ${PROJECT_PATH}/src/main.ts &>/dev/null & disown;
PATH_CONFIG=test/data/dev/n0000006/config.json deno run --allow-all ${PROJECT_PATH}/src/main.ts &>/dev/null & disown;

echo "OK, DevNet started"