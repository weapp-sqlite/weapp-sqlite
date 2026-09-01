#!/usr/bin/env bash
set -euo pipefail

package_root="$(cd "$(dirname "$0")/.." && pwd)"
image_name="weapp-sqlite-sqljs-lite:1.14.2-emscripten-5.0.0"

docker build --tag "$image_name" --file "$package_root/docker/Dockerfile" "$package_root"
docker run --rm --volume "$package_root/src/vendor:/output" "$image_name"
node "$package_root/scripts/update-lite-manifest.mjs"
node "$package_root/scripts/verify-lite.mjs"
