<#
.SYNOPSIS
    Build LitematicaBE and deploy it to a running BDS/LeviLamina server.

.DESCRIPTION
    One command for the everyday loop:

        xmake f (configure)  ->  xmake -y (build)  ->  deploy.ps1  ->  [verify-stage-a.ps1]

    Build output goes to bin/LitematicaBE (mod + manifest + holo_core.dll), then
    deploy.ps1 backs up and copies it into the server together with the BP/RP.

    The server MUST be stopped: a loaded DLL cannot be overwritten.

    ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 without a BOM as ANSI.

.PARAMETER ServerRoot
    BDS root containing bedrock_server_mod.exe / bedrock_server.exe.

.PARAMETER Reconfigure
    Force 'xmake f' before building (needed after editing xmake.lua options).

.PARAMETER SkipBuild
    Deploy the existing bin/LitematicaBE without rebuilding.

.PARAMETER SkipDeploy
    Build only, do not touch the server.

.PARAMETER Verify
    After deploying, boot the server, run the console commands, stop it again.

.PARAMETER Commands
    Console commands for the verify step. Default: "lit probe".

.PARAMETER NoBackup
    Passed through to deploy.ps1.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\update.ps1 -ServerRoot 'C:\BDS'

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\update.ps1 -ServerRoot 'C:\BDS' -Verify
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $ServerRoot,
    [switch] $Reconfigure,
    [switch] $SkipBuild,
    [switch] $SkipDeploy,
    [switch] $Verify,
    [string[]] $Commands = @('lit probe'),
    [switch] $NoBackup
)

$ErrorActionPreference = 'Stop'

function Say([string] $m, [string] $c = 'Gray') { Write-Host $m -ForegroundColor $c }

$repo  = Split-Path $PSScriptRoot -Parent
$start = Get-Date

Say '================================================' 'Cyan'
Say ' LitematicaBE build + deploy' 'Cyan'
Say '================================================' 'Cyan'
Say "repo   : $repo"
Say "server : $ServerRoot"

# ------------------------------------------------------------- toolchain gate
if (-not $SkipBuild) {
    if (-not (Get-Command xmake -ErrorAction SilentlyContinue)) {
        throw 'xmake not found in PATH. Install it or open a shell that has it.'
    }
    $xmakePath = (Get-Command xmake).Source
    Say ("xmake  : " + $xmakePath) 'DarkGray'
}

# -------------------------------------------------------------------- version
# Not blocking: during development the version may legitimately be in flux.
if (Get-Command python -ErrorAction SilentlyContinue) {
    Push-Location (Join-Path $repo 'tools')
    try {
        $env:PYTHONIOENCODING = 'utf-8'
        $versionOut = python -m lit_tools version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $versionOut | ForEach-Object { Say ("  " + $_) 'DarkGray' }
        } else {
            Say '  (version check reported a mismatch - run it yourself: cd tools; python -m lit_tools version)' 'Yellow'
        }
    } catch {
        Say '  (version check skipped)' 'DarkGray'
    } finally {
        Pop-Location
    }
} else {
    Say '  (python not in PATH - skipping version check)' 'DarkGray'
}

# ---------------------------------------------------------------------- build
if (-not $SkipBuild) {
    Push-Location $repo
    try {
        $needConfigure = $Reconfigure -or -not (Test-Path (Join-Path $repo 'build\windows'))
        if ($needConfigure) {
            Say ''
            Say '==> xmake f -y -p windows -a x64 -m release' 'Cyan'
            & xmake f -y -p windows -a x64 -m release
            if ($LASTEXITCODE -ne 0) { throw 'xmake configure failed.' }
        }

        Say ''
        Say '==> xmake -y' 'Cyan'
        $buildLog = & xmake -y 2>&1
        $buildLog | Where-Object { $_ -match 'error|warning: |build ok|bundled|Mod Packer' } | ForEach-Object { Say $_ }
        if ($LASTEXITCODE -ne 0 -or -not ($buildLog -match 'build ok')) {
            $buildLog | Select-Object -Last 40 | ForEach-Object { Say $_ 'Red' }
            throw 'build failed (see output above).'
        }
    } finally {
        Pop-Location
    }
}

# ------------------------------------------------------------ artifact checks
$buildDir = Join-Path $repo 'bin\LitematicaBE'
foreach ($required in @('LitematicaBE.dll', 'manifest.json', 'holo_core.dll')) {
    if (-not (Test-Path (Join-Path $buildDir $required))) {
        throw "Missing artifact: $required in $buildDir"
    }
}
$modDll = Get-Item (Join-Path $buildDir 'LitematicaBE.dll')
Say ''
Say ("artifact: {0} bytes, built {1:HH:mm:ss}" -f $modDll.Length, $modDll.LastWriteTime) 'Green'

# --------------------------------------------------------------------- deploy
if (-not $SkipDeploy) {
    Say ''
    Say '==> deploy' 'Cyan'
    $deployArgs = @{ ServerRoot = $ServerRoot }
    if ($NoBackup) { $deployArgs['NoBackup'] = $true }
    & (Join-Path $PSScriptRoot 'deploy.ps1') @deployArgs
}

# --------------------------------------------------------------------- verify
if ($Verify -and -not $SkipDeploy) {
    Say ''
    Say '==> verify' 'Cyan'
    & (Join-Path $PSScriptRoot 'verify-stage-a.ps1') -ServerRoot $ServerRoot -Commands $Commands
}

$elapsed = (Get-Date) - $start
Say ''
Say ("done in {0:n1}s" -f $elapsed.TotalSeconds) 'Green'
if (-not $Verify) {
    Say 'tip: add -Verify to boot the server, run "lit probe" and stop it again.' 'DarkGray'
}
