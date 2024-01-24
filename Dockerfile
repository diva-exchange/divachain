#
# Copyright (C) 2021-2024 diva.exchange
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

FROM node:18-slim

LABEL author="DIVA.EXCHANGE Association <contact@diva.exchange>" \
  maintainer="DIVA.EXCHANGE Association <contact@diva.exchange>" \
  name="divachain" \
  description="Distributed digital value exchange upholding security, reliability and privacy" \
  url="https://diva.exchange"

COPY dist /dist
COPY node_modules /node_modules
COPY package.json /package.json
COPY package-lock.json /package-lock.json
COPY entrypoint.sh /entrypoint.sh

RUN mkdir /genesis \
  && mkdir /keys \
  && mkdir -p /db/chain \
  && mkdir -p /db/state \
  && chmod +x /entrypoint.sh

WORKDIR "/"
ENTRYPOINT ["/entrypoint.sh"]
