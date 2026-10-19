#!/bin/sh
set -eu

builder_name="${1:-vivatbus}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Do not change the server's default builder or other Coolify applications.
if ! docker buildx inspect "$builder_name" >/dev/null 2>&1; then
  docker buildx create \
    --name "$builder_name" \
    --driver docker-container \
    --driver-opt default-load=true \
    --buildkitd-config "$script_dir/buildkitd.toml"
fi

docker buildx inspect --bootstrap "$builder_name"
