#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
launcher_path="$HOME/Desktop/FloatFocus Timer.command"
log_path="/tmp/floatfocus-timer.log"

fail() {
  printf '\n%s\n' "$1" >&2
  exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This installer is for macOS. On Windows, run Install-FloatFocusTimer.cmd."
fi

command -v node >/dev/null 2>&1 || fail "Node.js was not found. Install Node.js LTS from https://nodejs.org/ and run this again."
command -v npm >/dev/null 2>&1 || fail "npm was not found. Install Node.js LTS from https://nodejs.org/ and run this again."

cd "$project_root"

printf 'Using Node.js: %s\n' "$(command -v node)"
printf 'Installing FloatFocus Timer dependencies...\n'
npm install

escaped_project_root="$(printf '%q' "$project_root")"
escaped_log_path="$(printf '%q' "$log_path")"

cat > "$launcher_path" <<LAUNCHER
#!/usr/bin/env bash
cd $escaped_project_root
npm start >$escaped_log_path 2>&1 &
LAUNCHER

chmod +x "$launcher_path"

printf '\nDone. Launch FloatFocus Timer from:\n%s\n' "$launcher_path"
printf 'If macOS blocks the first launch, right-click the launcher and choose Open.\n'
