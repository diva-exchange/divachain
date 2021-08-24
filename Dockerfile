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

FROM node:14-slim AS build

LABEL author="Konrad Baechler <konrad@diva.exchange>" \
  maintainer="Konrad Baechler <konrad@diva.exchange>" \
  name="divachain" \
  description="Distributed digital value exchange upholding security, reliability and privacy" \
  url="https://diva.exchange"

#############################################
# First stage: container used to build the binary
#############################################
COPY bin /divachain/bin
COPY src /divachain/src
COPY build/node14-linux-x64 /divachain/build/node14-linux-x64
COPY package.json /divachain/package.json
COPY tsconfig.json /divachain/tsconfig.json

RUN apt-get update \
  && apt-get install -y curl \
  && curl -fsSL https://get.pnpm.io/install.sh | sh - \
  && cd divachain \
  && mkdir genesis \
  && mkdir keys \
  && mkdir dist \
  && /root/.local/share/pnpm/pnpm add -g --verbose pkg \
  && /root/.local/share/pnpm/pnpm install --verbose \
  && bin/build.sh

#############################################
# Second stage: create the distroless image
#############################################
FROM gcr.io/distroless/cc
COPY package.json /package.json

# Copy the binary and the prebuilt dependencies
COPY --from=build /divachain/build/divachain-linux-x64 /divachain
COPY --from=build /divachain/build/prebuilds /prebuilds

# genesis and keys folder are just created empty - the content must be provided externally (like: a volume mount)
COPY --from=build /divachain/genesis /genesis
COPY --from=build /divachain/keys /keys

EXPOSE 17468 17469

CMD [ "/divachain" ]
