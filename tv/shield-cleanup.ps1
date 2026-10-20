<#
.SYNOPSIS
  Disables (or with -Undo, re-enables) unused and dead apps on a Shield.

.DESCRIPTION
  Uses `pm disable-user`, so nothing is uninstalled and every app comes back
  with -Undo. Needs Network debugging on, like deploy.ps1.

.EXAMPLE
  .\shield-cleanup.ps1 -Tv 192.168.1.164
.EXAMPLE
  .\shield-cleanup.ps1 -Tv 192.168.1.164 -Undo
#>
param(
  [Parameter(Mandatory)] [string]$Tv,
  [switch]$Undo
)

$ErrorActionPreference = "Stop"

$packages = @(
  # Dead or unused Google apps
  "com.google.android.music",              # Google Play Music (shut down)
  "com.google.android.videos",             # Google TV / Play Movies
  "com.google.android.apps.tachyon",       # Duo / Meet
  "com.google.android.play.games",         # Play Games
  # Streaming services that shut down
  "com.Funimation.FunimationNow.androidtv",
  "com.imdbtv.livingroom",                 # IMDb TV / Freevee
  # NVIDIA telemetry, feedback and beta program
  "com.nvidia.stats",
  "com.nvidia.feedback",
  "com.google.android.feedback",
  "com.nvidia.shield.beta",
  "com.nvidia.shieldbeta",
  "com.nvidia.stub.com.spotify.tv.android", # placeholder for an app that isn't installed
  # Suggested/sponsored rows on the home screen (the apps row stays)
  "com.google.android.tvrecommendations"
)

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$adb = Join-Path $sdk "platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "adb not found at $adb." }

$serial = if ($Tv -match ":\d+$") { $Tv } else { "${Tv}:5555" }
& $adb connect $serial | Out-Null

foreach ($p in $packages) {
  $result = if ($Undo) {
    & $adb -s $serial shell pm enable --user 0 $p 2>&1
  } else {
    & $adb -s $serial shell pm disable-user --user 0 $p 2>&1
  }
  "{0,-42} {1}" -f $p, ($result -join " ")
}
