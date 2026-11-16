#!/bin/bash
# Double-click on a Mac to set up Freedom reminder keys locally.
# Does not deploy the Worker. Never prints the private key.
set -euo pipefail
cd "$(dirname "$0")"
echo ""
echo "Freedom reminder key setup"
echo "=========================="
echo "Working folder: $(pwd)"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install the LTS version from https://nodejs.org then double-click this file again."
  read -r -p "Press Return to close…"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Re-install Node.js from https://nodejs.org then try again."
  read -r -p "Press Return to close…"
  exit 1
fi

node "./scripts/setup-vapid-secrets.mjs"
echo ""
read -r -p "Press Return to close…"
