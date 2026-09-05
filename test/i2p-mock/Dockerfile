#
# Copyright (C) 2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#

FROM denoland/deno:alpine

WORKDIR /app

# Kopiere nur den Inhalt des docker/ Unterordners in das Arbeitsverzeichnis des Containers
COPY docker/ /app/

# Mache den Entrypoint ausführbar
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]