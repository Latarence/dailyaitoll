#!/bin/bash
# Trigger Daily AI Toll collection on demand
#
# Usage:
#   ./trigger.sh              # Normal collection
#   ./trigger.sh full-scan    # Full historical scan
#
# Requires: GITHUB_TOKEN environment variable with repo scope

REPO="Latarence/dailyaitoll"
EVENT_TYPE="${1:-collect-toll}"

if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN not set"
    echo "Set it with: export GITHUB_TOKEN=ghp_..."
    exit 1
fi

echo "Triggering $EVENT_TYPE on $REPO..."

curl -s -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/$REPO/dispatches" \
  -d "{\"event_type\":\"$EVENT_TYPE\"}"

if [ $? -eq 0 ]; then
    echo "Triggered successfully. Check: https://github.com/$REPO/actions"
else
    echo "Failed to trigger workflow"
    exit 1
fi
