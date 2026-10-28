#!/bin/sh
# Rebuilds the bundled pty_bridge binaries with the Android NDK.
# Usage: ANDROID_NDK_HOME=/path/to/ndk src-tauri/pty-bridge/build.sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
out="$here/../resources/pty-bridge"
ndk="${ANDROID_NDK_HOME:-}"
if [ ! -d "$ndk" ]; then
  ndk=$(ls -d "$HOME"/Library/Android/sdk/ndk/* "$HOME"/Android/Sdk/ndk/* 2>/dev/null | sort -V | tail -1)
fi
[ -d "$ndk" ] || { echo "NDK not found, set ANDROID_NDK_HOME" >&2; exit 1; }
bin=$(ls -d "$ndk"/toolchains/llvm/prebuilt/*/bin | head -1)

for pair in "arm64-v8a aarch64" "x86_64 x86_64"; do
  set -- $pair
  mkdir -p "$out/$1"
  "$bin/$2-linux-android21-clang" -O2 -s -Wall -Wextra \
    -o "$out/$1/pty_bridge" "$here/pty_bridge.c"
  echo "built $out/$1/pty_bridge"
done
