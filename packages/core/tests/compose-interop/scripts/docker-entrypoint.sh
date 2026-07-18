#!/usr/bin/env bash
# Container entry: apply static netem, then start the Compose node runner.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/apply-netem.sh"
exec node dist/tests/compose-interop/composeNodeMain.js
