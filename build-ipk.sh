#!/bin/bash
# Builds the distributable MLB At Bat 11 .ipk: app + com.mlb.atbat2011.service,
# packaged via palm-package's Usage-2 form, with packaging/postinst injected
# into the package's control archive so the service self-registers on the
# LS2 bus on install -- no manual novacom/deploy-script step needed by end
# users. See packaging/postinst for why this is necessary at all, and the
# project plan for how this was discovered/confirmed working live.
#
# Run this from WSL (uses ar/tar, not available to a plain PowerShell
# session) -- it shells out to the Windows-only palm-package.bat itself via
# powershell.exe, same as the rest of this project's devkit tooling.
#
# Usage: ./build-ipk.sh
# Output: dist/com.mlb.atbat2011_<version>_all.ipk (version comes from
# app/extracted/.../com.mlb.atbat2011.package/packageinfo.json -- this
# script never bumps it).
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_DIR="$PROJECT_ROOT/app/extracted/usr/palm/applications"
DIST_DIR="$PROJECT_ROOT/dist"
POSTINST="$PROJECT_ROOT/packaging/postinst"

WIN_PALM_PACKAGE='C:\Users\alanm\OneDrive\Documents\Projects\cbssports\devkit\SDK\bin\palm-package.bat'
WIN_APPS_DIR='C:\Users\alanm\OneDrive\Documents\Projects\mlbatbat\app\extracted\usr\palm\applications'
WIN_DIST_DIR='C:\Users\alanm\OneDrive\Documents\Projects\mlbatbat\dist'

rm -f "$DIST_DIR"/com.mlb.atbat2011_*_all.ipk

powershell.exe -Command "& '$WIN_PALM_PACKAGE' -o '$WIN_DIST_DIR' '$WIN_APPS_DIR\com.mlb.atbat2011.package' '$WIN_APPS_DIR\com.mlb.atbat2011' '$WIN_APPS_DIR\com.mlb.atbat2011.service'"

IPK=$(ls "$DIST_DIR"/com.mlb.atbat2011_*_all.ipk | head -1)
echo "palm-package built: $IPK"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

cd "$WORKDIR"
ar x "$IPK"

mkdir control_extract
cd control_extract
tar xzf ../control.tar.gz
cp "$POSTINST" ./postinst
chmod 755 ./postinst ./control
tar czf ../control.tar.gz ./control ./postinst
cd ..

rm -f "$IPK"
ar rc "$IPK" debian-binary control.tar.gz data.tar.gz

echo "postinst injected -- final package: $IPK"
ar t "$IPK"
