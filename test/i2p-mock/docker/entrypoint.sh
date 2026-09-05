#!/bin/sh
#
# Copyright (C) 2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#

echo "Starting I2P Mock Container (Native Deno Simulation)..."

# Execute the CMD passed from Docker (e.g., 'deno run ... tcp-mock.ts' or 'udp-mock.ts')
exec "$@"