#!/usr/bin/env bash
#
# Copyright (C) 2021-2023 diva.exchange
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
PROJECT_PATH=$( pwd )

source "${PROJECT_PATH}"/bin/echos.sh
source "${PROJECT_PATH}"/bin/helpers.sh

if ! command_exists npm; then
  error "npm not available. Install node";
  exit 1
fi

npm i --omit-dev

info "Clean up..."
rm -rf "${PROJECT_PATH}"/dist/*
rm -rf "${PROJECT_PATH}"/build/prebuilds
rm -rf "${PROJECT_PATH}"/build/divachain-*

info "Transpiling TypeScript to JavaScript..."
node_modules/.bin/tsc
cp -r "${PROJECT_PATH}"/src/schema "${PROJECT_PATH}"/dist/schema

# create a static version file
node "${PROJECT_PATH}"/dist/version.js
rm -rf "${PROJECT_PATH}"/dist/version.js
rm -rf "${PROJECT_PATH}"/dist/version.js.map
rm -rf "${PROJECT_PATH}"/dist/version.d.ts
