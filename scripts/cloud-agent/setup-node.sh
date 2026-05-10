#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".nvmrc" ]]; then
  echo "Missing .nvmrc in repository root" >&2
  exit 1
fi

NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
if [[ -z "$NODE_VERSION" ]]; then
  echo "Expected a Node version in .nvmrc" >&2
  exit 1
fi

FNM_BIN=""
if command -v fnm >/dev/null 2>&1; then
  FNM_BIN="$(command -v fnm)"
elif [[ -x "$HOME/.local/share/fnm/fnm" ]]; then
  FNM_BIN="$HOME/.local/share/fnm/fnm"
elif [[ -x "$HOME/.fnm/fnm" ]]; then
  FNM_BIN="$HOME/.fnm/fnm"
else
  curl -fsSL https://fnm.vercel.app/install | bash
  if [[ -x "$HOME/.local/share/fnm/fnm" ]]; then
    FNM_BIN="$HOME/.local/share/fnm/fnm"
  elif [[ -x "$HOME/.fnm/fnm" ]]; then
    FNM_BIN="$HOME/.fnm/fnm"
  else
    echo "Installed fnm but could not locate binary" >&2
    exit 1
  fi
fi

if [[ ! -x "$FNM_BIN" ]]; then
  echo "fnm binary is not executable: $FNM_BIN" >&2
  exit 1
fi

mkdir -p "$HOME/.local/bin"

if [[ -f "$HOME/.bashrc" ]]; then
  if ! grep -F "CURSOR_CLOUD_FNM_SETUP" "$HOME/.bashrc" >/dev/null 2>&1; then
    {
      echo ""
      echo "# CURSOR_CLOUD_FNM_SETUP"
      echo 'if [ -x "$HOME/.local/share/fnm/fnm" ]; then'
      echo '  export PATH="$HOME/.local/share/fnm:$PATH"'
      echo '  eval "$("$HOME/.local/share/fnm/fnm" env --use-on-cd --shell bash)"'
      echo 'fi'
      echo 'if [ -x "$HOME/.fnm/fnm" ]; then'
      echo '  export PATH="$HOME/.fnm:$PATH"'
      echo '  eval "$("$HOME/.fnm/fnm" env --use-on-cd --shell bash)"'
      echo 'fi'
      echo "# /CURSOR_CLOUD_FNM_SETUP"
    } >> "$HOME/.bashrc"
  fi
fi

eval "$("$FNM_BIN" env --shell bash)"
"$FNM_BIN" install "$NODE_VERSION"
"$FNM_BIN" use "$NODE_VERSION"
"$FNM_BIN" default "$NODE_VERSION"

NODE_BIN_DIR="$(dirname "$(command -v node)")"
for tool in node npm npx corepack; do
  if [[ -x "$NODE_BIN_DIR/$tool" ]]; then
    ln -sf "$NODE_BIN_DIR/$tool" "$HOME/.local/bin/$tool"
  fi
done

export PATH="$HOME/.local/bin:$PATH"
node --version
npm --version
