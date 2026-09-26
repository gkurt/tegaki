#!/usr/bin/env bash
# Run Playwright e2e tests inside the same Ubuntu image that CI uses, so the
# generated snapshots match what `e2e` job in .github/workflows/ci.yml expects.
#
# Usage:
#   scripts/e2e-docker.sh               # run tests (compare against committed linux snapshots)
#   scripts/e2e-docker.sh --update      # regenerate linux snapshots that no longer match
#   scripts/e2e-docker.sh --update-all  # regenerate every linux snapshot, even ones within tolerance
set -euo pipefail

# Keep in sync with the @playwright/test version in package.json and the CI image.
IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble

# Resolve the monorepo root (two levels up from this script).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

CMD="bun test:e2e"
if [ "${1:-}" = "--update" ]; then
  CMD="bun test:e2e:update"
elif [ "${1:-}" = "--update-all" ]; then
  CMD="bunx playwright test --update-snapshots=all"
fi

docker run --rm \
  -v "$REPO_ROOT:/work" \
  -w /work \
  --ipc=host \
  "$IMAGE" \
  bash -c "
    set -e
    apt-get update -qq >/dev/null && apt-get install -y -qq unzip >/dev/null
    curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
    export PATH=\$HOME/.bun/bin:\$PATH
    bun i --frozen-lockfile
    cd packages/website
    $CMD
    chown -R $(id -u):$(id -g) /work/packages/website/tests /work/node_modules /work/packages/website/node_modules 2>/dev/null || true
  "
