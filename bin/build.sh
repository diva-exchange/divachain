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

source "${PROJECT_PATH}bin/echos.sh"
source "${PROJECT_PATH}bin/helpers.sh"

BUILD=${BUILD}
case ${BUILD} in
  linux-arm64)
    ;;
  *)
    BUILD=linux-x64
    ;;
esac


info "Transpiling TypeScript to JavaScript..."
rm -rf ${PROJECT_PATH}dist/*
${PROJECT_PATH}node_modules/.bin/tsc
cp -r ${PROJECT_PATH}src/schema ${PROJECT_PATH}dist/schema

if command_exists pkg; then
  info "Packaging..."

  info "Building ${BUILD}"

  rm -rf ${PROJECT_PATH}build/divachain-${BUILD}
  rm -rf ${PROJECT_PATH}build/prebuilds
  mkdir -p ${PROJECT_PATH}build/prebuilds/
  cp -r ${PROJECT_PATH}node_modules/leveldown/prebuilds/${BUILD} ${PROJECT_PATH}build/prebuilds/

  cd build/node14-${BUILD}
  pkg --no-bytecode \
    --public \
    --output ${PROJECT_PATH}build/divachain-${BUILD} \
    .
else
  info "Skipping Packaging..."
  warn "Reason: pkg not available. Install it with npm i -g pkg";
fi