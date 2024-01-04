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
source "${PROJECT_PATH}"/bin/compile.sh

if command_exists pkg; then
  info "Packaging..."

  #classic-level prebuilds
  [[ -d "${PROJECT_PATH}"/node_modules/classic-level/prebuilds/ ]] &&
    mkdir -p "${PROJECT_PATH}"/build/prebuilds &&
    cp -r "${PROJECT_PATH}"/node_modules/classic-level/prebuilds/linux-x64 "${PROJECT_PATH}"/build/prebuilds/linux-x64

  pkg --no-bytecode \
    --public \
    --output "${PROJECT_PATH}"/build/divachain-linux-x64 \
    .
else
  info "Skipping Packaging..."
  warn "Reason: pkg not available. Install it with npm i -g pkg";
fi