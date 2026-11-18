#!/bin/zsh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 '/absolute/path/to/Obsidian Vault'" >&2
  exit 1
fi

vault_path="$1"
if [ ! -d "$vault_path" ]; then
  echo "Vault directory does not exist: $vault_path" >&2
  exit 1
fi

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
node_path="$(command -v node)"
agent_path="$HOME/Library/LaunchAgents/com.vonwen.codex-obsidian.plist"
stdout_path="$HOME/Library/Logs/codex-obsidian.log"
stderr_path="$HOME/Library/Logs/codex-obsidian.error.log"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

escaped_project=${project_dir//&/&amp;}
escaped_project=${escaped_project//</&lt;}
escaped_project=${escaped_project//>/&gt;}
escaped_vault=${vault_path//&/&amp;}
escaped_vault=${escaped_vault//</&lt;}
escaped_vault=${escaped_vault//>/&gt;}

cat > "$agent_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.vonwen.codex-obsidian</string>
  <key>ProgramArguments</key>
  <array><string>${node_path}</string><string>${escaped_project}/server.mjs</string></array>
  <key>WorkingDirectory</key><string>${escaped_project}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OBSIDIAN_VAULT_PATH</key><string>${escaped_vault}</string>
    <key>CODEX_OBSIDIAN_HOST</key><string>127.0.0.1</string>
    <key>CODEX_OBSIDIAN_PORT</key><string>43128</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${stdout_path}</string>
  <key>StandardErrorPath</key><string>${stderr_path}</string>
</dict>
</plist>
PLIST

plutil -lint "$agent_path"
launchctl bootout "gui/$(id -u)" "$agent_path" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$agent_path"

echo "Codex Obsidian is running at http://127.0.0.1:43128/"
