#!/usr/bin/env bash
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // "unknown"')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

dir=$(basename "$cwd")

if [ -n "$used" ]; then
  used_display=" | context: ${used}% used"
else
  used_display=""
fi

printf "%s  %s%s" "$model" "$dir" "$used_display"
