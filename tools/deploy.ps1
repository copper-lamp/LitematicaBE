<#
.SYNOPSIS
    Deploy LitematicaBE into a Bedrock Dedicated Server (LeviLamina) installation.

.DESCRIPTION
    Copies the built mod, the ghost-block behavior/resource packs and the bundled
    holo_core.dll next to the plugin, then checks the HologramLib prerequisite.

      bin/LitematicaBE                 -> plugins/LitematicaBE
      resources/addon/LitematicaBE_BP  -> behavior_packs/LitematicaBE_BP
      resources/addon/LitematicaBE_RP  -> resource_packs/LitematicaBE_RP

    Target directories are wiped and rewritten so that leftovers from the old
    LSE-based packs cannot survive. Everything is backed up first to
    .deploy-backup/<timestamp>/ unless -NoBackup is given.

    This file is deliberately ASCII-only: Windows PowerShell 5.1 reads .ps1
    without a BOM as ANSI (GBK), which corrupts non-ASCII string literals.

.PARAMETER ServerRoot
    BDS root directory, the one that contains bedrock_server.exe or
    bedrock_server_mod.exe.

.PARAMETER NoBackup
    Skip the backup step (use only when you know the target dirs are disposable).

.PARAMETER NoStopCheck
    Do not abort when a server process is running (the copy will probably fail).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\deploy.ps1 -ServerRoot 'C:\Users\me\Desktop\MCBEserver1.21.132'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $ServerRoot,
    [switch] $NoBackup,
    [switch] $NoStopCheck
)

$ErrorActionPreference = 'Stop'

function Write-Step([string] $message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Ok([string] $message)   { Write-Host "  ok   $message" -ForegroundColor Green }
function Write-Warn2([string] $message) { Write-Host "  warn $message" -ForegroundColor Yellow }
function Write-Bad([string] $message)  { Write-Host "  FAIL $message" -ForegroundColor Red }

$repo     = Split-Path $PSScriptRoot -Parent
$buildDir = Join-Path $repo 'bin\LitematicaBE'
$addonDir = Join-Path $repo 'resources\addon'

# ---------------------------------------------------------------- resolve root
Write-Step 'Resolving server root'

if (-not (Test-Path $ServerRoot)) { throw "ServerRoot does not exist: $ServerRoot" }
$ServerRoot = (Resolve-Path $ServerRoot).Path

$launcher = $null
foreach ($candidate in @('bedrock_server_mod.exe', 'bedrock_server.exe')) {
    if (Test-Path (Join-Path $ServerRoot $candidate)) { $launcher = $candidate; break }
}
if ($null -eq $launcher) {
    throw "'$ServerRoot' has neither bedrock_server_mod.exe nor bedrock_server.exe - not a BDS root."
}
Write-Ok "root      : $ServerRoot"
Write-Ok "launcher  : $launcher"

if (Test-Path (Join-Path $ServerRoot 'plugins\LeviLamina\LeviLamina.dll')) {
    Write-Ok 'LeviLamina: present'
} else {
    Write-Warn2 'plugins\LeviLamina\LeviLamina.dll not found - install LeviLamina first.'
}

# ------------------------------------------------------------ running server?
if (-not $NoStopCheck) {
    $running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -match 'bedrock_server' -or $_.ProcessName -match 'LeviLamina'
    }
    if ($running) {
        $names = ($running | ForEach-Object { $_.ProcessName } | Select-Object -Unique) -join ', '
        Write-Bad "server process is running: $names"
        throw 'Stop the server before deploying (or pass -NoStopCheck).'
    }
    Write-Ok 'server not running'
}

# ---------------------------------------------------------------- sanity check
Write-Step 'Checking build artifacts'

foreach ($required in @('LitematicaBE.dll', 'manifest.json', 'holo_core.dll')) {
    $path = Join-Path $buildDir $required
    if (-not (Test-Path $path)) { throw "Missing build artifact: $path (run 'xmake -y' first)." }
}
Write-Ok "mod       : $buildDir"

$bpSource = Join-Path $addonDir 'LitematicaBE_BP'
$rpSource = Join-Path $addonDir 'LitematicaBE_RP'
foreach ($src in @($bpSource, $rpSource)) {
    if (-not (Test-Path $src)) { throw "Missing addon directory: $src" }
}
Write-Ok 'addons    : BP + RP'

# --------------------------------------------------------------------- targets
# The plugin dir holds runtime state (config/, data/), so it is overwritten in
# place. The packs are wiped and rewritten so leftovers from the old LSE-based
# packs cannot survive.
$targets = @(
    @{ Source = $buildDir; Target = (Join-Path $ServerRoot 'plugins\LitematicaBE'); Label = 'plugin'; Wipe = $false },
    @{ Source = $bpSource; Target = (Join-Path $ServerRoot 'behavior_packs\LitematicaBE_BP'); Label = 'BP'; Wipe = $true },
    @{ Source = $rpSource; Target = (Join-Path $ServerRoot 'resource_packs\LitematicaBE_RP'); Label = 'RP'; Wipe = $true }
)

# ---------------------------------------------------------------------- backup
if (-not $NoBackup) {
    Write-Step 'Backing up existing deployment'
    $stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = Join-Path $ServerRoot ".deploy-backup\$stamp"
    $count     = 0
    foreach ($item in $targets) {
        if (Test-Path $item.Target) {
            $children = Get-ChildItem $item.Target -Force -ErrorAction SilentlyContinue
            if ($children) {
                $dest = Join-Path $backupDir $item.Label
                New-Item -ItemType Directory -Force -Path $dest | Out-Null
                $children | Copy-Item -Destination $dest -Recurse -Force
                $count++
            }
        }
    }
    if ($count -gt 0) { Write-Ok "backup    : $backupDir" } else { Write-Ok 'backup    : nothing to save' }
}

# ------------------------------------------------------------------------ copy
Write-Step 'Deploying (wipe + copy)'

foreach ($item in $targets) {
    if ($item.Wipe -and (Test-Path $item.Target)) { Remove-Item $item.Target -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $item.Target | Out-Null
    Get-ChildItem $item.Source -Force | Copy-Item -Destination $item.Target -Recurse -Force
    $files = (Get-ChildItem $item.Target -Recurse -File).Count
    Write-Ok ("{0,-6} -> {1} ({2} files)" -f $item.Label, $item.Target, $files)
}

# --------------------------------------------------------------- prerequisites
Write-Step 'Checking prerequisites'

$hologramLibDir = Join-Path $ServerRoot 'plugins\HologramLib'
if (Test-Path (Join-Path $hologramLibDir 'HologramLib.dll')) {
    try {
        $manifest = Get-Content (Join-Path $hologramLibDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Ok ("HologramLib {0} (api {1}, abi {2})" -f $manifest.version, $manifest.extraInfo.apiVersionSemver, $manifest.extraInfo.abiStamp)
    } catch {
        Write-Warn2 'HologramLib present, but manifest.json could not be parsed.'
    }
} else {
    Write-Warn2 'HologramLib missing under plugins\HologramLib - /lit probe will report "none".'
}

$bundledCore = Join-Path $ServerRoot 'plugins\LitematicaBE\holo_core.dll'
if (Test-Path $bundledCore) { Write-Ok "batch encoder: $bundledCore" } else { Write-Warn2 'holo_core.dll missing - batch path falls back to per-cell.' }

# ------------------------------------------------------------ world pack hints
Write-Step 'Checking world pack references'

$worldRoot = Join-Path $ServerRoot 'worlds'
$bpId = $null
$rpId = $null
try {
    $bpManifest = Get-Content (Join-Path $bpSource 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $rpManifest = Get-Content (Join-Path $rpSource 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $bpId = $bpManifest.header.uuid
    $rpId = $rpManifest.header.uuid
} catch {
    Write-Warn2 'Could not read pack manifests.'
}

if ((Test-Path $worldRoot) -and $bpId) {
    foreach ($world in Get-ChildItem $worldRoot -Directory) {
        $bpRefFile = Join-Path $world.FullName 'world_behavior_packs.json'
        $rpRefFile = Join-Path $world.FullName 'world_resource_packs.json'
        $hasBp = $false
        $hasRp = $false
        if (Test-Path $bpRefFile) { $hasBp = ((Get-Content $bpRefFile -Raw -Encoding UTF8) -match [regex]::Escape($bpId)) }
        if (Test-Path $rpRefFile) { $hasRp = ((Get-Content $rpRefFile -Raw -Encoding UTF8) -match [regex]::Escape($rpId)) }
        if ($hasBp -and $hasRp) {
            Write-Ok ("{0}: BP + RP referenced" -f $world.Name)
        } else {
            Write-Warn2 ("{0}: BP={1} RP={2} - enable both in world settings (lit:g_* parsing needs the BP)" -f $world.Name, $hasBp, $hasRp)
        }
    }
} else {
    Write-Warn2 'No worlds found - create/enable a world, then reference LitematicaBE_BP and LitematicaBE_RP.'
}

# ------------------------------------------------------------------ next steps
Write-Host ''
Write-Host 'Next steps' -ForegroundColor Cyan
Write-Host '  1. Start the server. Expect in the log:'
Write-Host '       [LitematicaBE] LitematicaBE enabled, display path batch-encoder: HologramLib: batch encoder ready'
Write-Host '       [LitematicaBE] command /lit registered (probe / info / load / layer / share)'
Write-Host '  2. In game: /lit probe   -> 4 samples resolve, packetId != 0'
Write-Host '  3. In game: /lit load <file>  -> the projection shows up at your feet (world unchanged)'
Write-Host '  4. In game: /lit share off    -> only you can see the projection you placed'
Write-Host '  5. In game: /lit place        -> really writes the projection into the world (config/place.json gate)'
Write-Host ''
Write-Host 'Checklist: docs/stage-a-acceptance.md' -ForegroundColor DarkGray
