# Installs the already-built MLB At Bat 11 .ipk (dist/com.mlb.atbat2011_*_all.ipk)
# to the connected TouchPad, then re-runs the LS2 (Luna Service Bus)
# registration for com.mlb.atbat2011.service as a safety net.
#
# NOTE: as of this project's testing, the .ipk itself (when built with
# ./build-ipk.sh, from WSL) already self-registers the service on install
# via a baked-in postinst script (see packaging/postinst) -- confirmed live
# by installing via webOS Quick Install with NO other step and immediately
# getting a working palm://com.mlb.atbat2011.service/getStatus response.
# End users distributing/installing this app via Quick Install, palm-install,
# or any other installer should never need this script at all.
#
# This script still exists for two cases: (1) re-registering after
# installing an .ipk that was built via plain palm-package (no postinst,
# e.g. by accident) and (2) as a manual fallback/diagnostic if a future
# webOS update or install path ever stops honoring postinst scripts. Both
# are dev/debugging scenarios, not the expected end-user path.
#
# Run: ./build-ipk.sh first (from WSL) to produce dist/com.mlb.atbat2011_*_all.ipk,
# then from Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File deploy-mlbatbat-audio.ps1

$ErrorActionPreference = 'Stop'

$devkitBin = 'C:\Users\alanm\OneDrive\Documents\Projects\cbssports\devkit\SDK\bin'
$palmInstall = Join-Path $devkitBin 'palm-install.bat'
$novacom = Join-Path $devkitBin 'novacom.exe'

$distDir = 'C:\Users\alanm\OneDrive\Documents\Projects\mlbatbat\dist'
$svc = 'com.mlb.atbat2011.service'

$ipk = Get-ChildItem (Join-Path $distDir 'com.mlb.atbat2011_*_all.ipk') | Select-Object -First 1
if (-not $ipk) {
	throw "No .ipk found in $distDir -- run ./build-ipk.sh from WSL first."
}
& $palmInstall $ipk.FullName

# Fallback/safety-net LS2 registration -- see header comment. Harmless and
# idempotent if the postinst script already did this during palm-install.
$deviceScript = @'

SVC=com.mlb.atbat2011.service
DIR=/media/cryptofs/apps/usr/palm/services/$SVC

cat > /var/palm/ls2/services/pub/$SVC <<EOF
[D-BUS Service]
Name=$SVC
Exec=/usr/bin/run-js-service -n $DIR
EOF
cp /var/palm/ls2/services/pub/$SVC /var/palm/ls2/services/prv/$SVC

cat > /var/palm/ls2/roles/pub/$SVC.json <<'JSON'
{ "role": { "exeName":"js", "type":"regular", "allowedNames":["com.mlb.atbat2011.service"] },
  "permissions": [ { "service":"com.mlb.atbat2011.service", "inbound":["*"], "outbound":["*"] } ] }
JSON
sed 's/"outbound":\["\*"\]/"outbound":[]/' /var/palm/ls2/roles/pub/$SVC.json > /var/palm/ls2/roles/prv/$SVC.json

PID=`ps ax | grep $SVC.js | grep -v grep | awk '{print $1}'`
[ -n "$PID" ] && kill -9 $PID && echo "killed stale pid $PID" || echo "no stale instance"
for p in `ps ax | grep gst-launch | grep -v grep | awk '{print $1}'`; do kill -9 $p; done

ls-control scan-services >/dev/null 2>&1
echo "registered $SVC on the bus"
echo "---EXIT---"; exit
'@
$deviceScript | & $novacom -t open tty://

Write-Host "`nDone. Launch with: palm-launch com.mlb.atbat2011" -ForegroundColor Green
