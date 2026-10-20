<#
.SYNOPSIS
  Builds the Android TV shell and installs it on a Shield over the network.

.DESCRIPTION
  On the Shield first: Settings > Device Preferences > About, press OK on
  "Build" seven times to unlock Developer options, then turn on
  Developer options > Network debugging. The first connection shows an
  "Allow USB debugging?" prompt on the TV — accept it and run this again.

.EXAMPLE
  .\deploy.ps1 -Tv 192.168.1.60 -Login
  First install: builds, installs, signs the TV in to Home Assistant and
  opens the app.

.EXAMPLE
  .\deploy.ps1 -Tv 192.168.1.60
  Reinstall after changing the shell. The saved login stays.
#>
param(
  # The Shield's IP address (Settings > Device Preferences > About > Status).
  # Leave out if adb is already connected to exactly one device.
  [string]$Tv,
  # Load the dashboard from somewhere other than gradle.properties' dashboardUrl.
  [string]$DashboardUrl,
  # Home Assistant as the TV reaches it. Only used with -Login.
  [string]$HaUrl = "http://192.168.1.54:8123",
  # Ask for a long-lived access token and sign the TV in, instead of typing
  # it with the remote.
  [switch]$Login
)

$ErrorActionPreference = "Stop"
$package = "io.github.rufogongora.homedashboard"

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$adb = Join-Path $sdk "platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "adb not found at $adb. Install the Android SDK platform-tools or set ANDROID_HOME." }
$env:ANDROID_HOME = $sdk

# Gradle 8.14 runs on JDK 17-24, and Android Studio's bundled runtime can be
# newer than that, so prefer the standalone JDK when JAVA_HOME isn't set.
if (-not $env:JAVA_HOME) {
  $jdk = Get-ChildItem "C:\Program Files\Android\openjdk" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}

function Invoke-Adb {
  & $adb @device @args
  if ($LASTEXITCODE -ne 0) { throw "adb $($args -join ' ') failed." }
}

$device = @()
if ($Tv) {
  $serial = if ($Tv -match ":\d+$") { $Tv } else { "${Tv}:5555" }
  & $adb connect $serial
  $device = @("-s", $serial)
}

Push-Location $PSScriptRoot
try {
  & .\gradlew.bat assembleDebug -q
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }
  Invoke-Adb install -r "app\build\outputs\apk\debug\app-debug.apk"
} finally {
  Pop-Location
}

# One-time setup the shell reads on its next start (MainActivity.readConfig)
# and then deletes. Piped straight into the app's private files dir, which
# only adb can do (run-as, debug builds), so the token never sits in a file
# on this PC or anywhere readable on the TV.
$config = @{}
if ($DashboardUrl) { $config.url = $DashboardUrl }
if ($Login) {
  $secure = Read-Host "Home Assistant long-lived access token" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $config.haToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $config.haUrl = $HaUrl
}
if ($config.Count -gt 0) {
  ($config | ConvertTo-Json -Compress) |
    & $adb @device shell "run-as $package sh -c 'mkdir -p files && cat > files/config.json'"
  if ($LASTEXITCODE -ne 0) { throw "Couldn't write the setup file to the TV." }
  Invoke-Adb shell am force-stop $package
}

Invoke-Adb shell am start -n "$package/.MainActivity"
