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

echo -n "Terminating "`pgrep -f "^node .*${PROJECT_PATH}dist/main.js$" | wc -l`" processes..."

if [[ `pgrep -f "^node .*${PROJECT_PATH}dist/main.js$"` ]]
then
  pkill -SIGTERM -f "^node .*${PROJECT_PATH}dist/main.js$"
fi

while [[ `pgrep -f "^node .*${PROJECT_PATH}dist/main.js$"` ]]
do
  if [[ `pgrep -f "^node .*${PROJECT_PATH}dist/main.js$"` ]]
  then
    echo -n "."
    sleep 2
  fi
done

echo "done"
