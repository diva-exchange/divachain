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

FROM node:12-slim AS build

LABEL author="Konrad Baechler <konrad@diva.exchange>" \
  maintainer="Konrad Baechler <konrad@diva.exchange>" \
  name="divachain" \
  description="Distributed digital value exchange upholding security, reliability and privacy" \
  url="https://diva.exchange"

COPY dist /app/dist
COPY package.json /app/
COPY config /app/config
COPY schema /app/schema

RUN mkdir /app/log \
  && mkdir /app/blockstore \
  && mkdir /app/state \
  && cd /app/ \
  && npm i --only=production

FROM gcr.io/distroless/nodejs:12
COPY --from=build /app /app

EXPOSE 17468

WORKDIR /app
CMD [ "dist/main.js" ]
