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

COPY bin /divachain/bin
COPY src /divachain/src
COPY build/node12-linux-x64 /divachain/build/node12-linux-x64
COPY package.json /divachain/package.json
COPY tsconfig.json /divachain/tsconfig.json

RUN cd divachain \
  && mkdir dist \
  && npm i -g pkg \
  && npm i \
  && bin/build.sh

FROM gcr.io/distroless/cc
COPY --from=build /divachain/build/prebuilds /prebuilds
COPY --from=build /divachain/build/divachain-linux-x64 /divachain
COPY genesis /genesis
COPY package.json /package.json

EXPOSE 17468 17469

CMD [ "/divachain" ]
