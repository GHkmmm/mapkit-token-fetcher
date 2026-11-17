#!/bin/sh
# 在宿主机执行：源码目录可以独立于包含凭证和缓存的运行目录。
set -eu
SOURCE_DIR=${1:?请指定已验证的源码目录}
IMAGE_TAG=${2:?请指定镜像版本}
RUNTIME_DIR=${3:-/app/mapkit-token-fetcher}
case "$IMAGE_TAG" in *[!a-zA-Z0-9_.-]*|'') exit 2;; esac
docker build -t "mapkit-token-fetcher:$IMAGE_TAG" "$SOURCE_DIR"
OLD_IMAGE=$(docker inspect --format '{{.Image}}' mapkit-token-fetcher)
ROLLBACK_TAG="rollback-$(date +%Y%m%d%H%M%S)"
docker tag "$OLD_IMAGE" "mapkit-token-fetcher:$ROLLBACK_TAG"
OVERRIDE="$RUNTIME_DIR/docker-compose.release.yml"
cat > "$OVERRIDE" <<EOF
services:
  mapkit-token-fetcher:
    image: mapkit-token-fetcher:$IMAGE_TAG
    mem_limit: 2g
    pids_limit: 512
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
EOF
docker compose --project-directory "$RUNTIME_DIR" -p mapkit-token-fetcher \
  -f "$RUNTIME_DIR/docker-compose.yml" -f "$RUNTIME_DIR/docker-compose.override.yml" \
  -f "$OVERRIDE" up -d --no-build --no-deps mapkit-token-fetcher
printf '发布镜像：%s\n回滚镜像：%s\n' "$IMAGE_TAG" "$ROLLBACK_TAG"
# 回滚：将 release 文件中的 image 改成以上回滚镜像，再执行同一 compose up 命令。
