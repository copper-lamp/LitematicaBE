<#
.SYNOPSIS
    Boot the server, run LitematicaBE console commands, collect the log, stop the server.

.DESCRIPTION
    Stage A verification harness. It starts the BDS launcher with stdin/stdout
    redirected, waits for LitematicaBE to report its display path, feeds the
    given console commands (default: "lit probe"), waits, then stops the server.

    Console commands run as the server console, so player-only subcommands
    ("lit share" / "lit easyplace" / "lit printer") will answer that they need
    a player - that is the expected result here. Use them from inside the game.

    ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 without a BOM as ANSI.

.PARAMETER ServerRoot
    BDS root containing bedrock_server_mod.exe / bedrock_server.exe.

.PARAMETER TimeoutSeconds
    Total budget for boot + world load. Default 300.

.PARAMETER Commands
    Console commands to feed after the mod reports ready.

.PARAMETER KeepRunning
    Do not stop the server at the end (you stop it yourself).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-stage-a.ps1 -ServerRoot 'C:\BDS'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $ServerRoot,
    [int] $TimeoutSeconds = 300,
    [string[]] $Commands = @('lit probe'),
    [switch] $KeepRunning
)

$ErrorActionPreference = 'Stop'

function Say([string] $m, [string] $c = 'Gray') { Write-Host $m -ForegroundColor $c }

if (-not (Test-Path $ServerRoot)) { throw "ServerRoot does not exist: $ServerRoot" }
$ServerRoot = (Resolve-Path $ServerRoot).Path

$exe = $null
foreach ($c in @('bedrock_server_mod.exe', 'bedrock_server.exe')) {
    if (Test-Path (Join-Path $ServerRoot $c)) { $exe = Join-Path $ServerRoot $c; break }
}
if ($null -eq $exe) { throw "No BDS launcher under $ServerRoot" }

$busy = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'bedrock_server' }
if ($busy) { throw 'A server process is already running; stop it first.' }

# ------------------------------------------------------------------- start up
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName               = $exe
$psi.WorkingDirectory       = $ServerRoot
$psi.UseShellExecute        = $false
$psi.RedirectStandardInput  = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError  = $true
$psi.CreateNoWindow         = $true

Say "==> starting $exe" 'Cyan'
$proc = [System.Diagnostics.Process]::Start($psi)

# Drain stderr so the child never blocks on a full pipe.
$proc.add_ErrorDataReceived({ param($s, $e) })
$proc.BeginErrorReadLine()

$lines       = New-Object System.Collections.Generic.List[string]
$probeStart  = -1
$readySeen   = $false
$deadline    = (Get-Date).AddSeconds($TimeoutSeconds)
$pendingTask = $null
$commandsSent = $false

while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { break }

    if ($null -eq $pendingTask) { $pendingTask = $proc.StandardOutput.ReadLineAsync() }
    if (-not $pendingTask.Wait(400)) { continue }

    $line = $pendingTask.Result
    $pendingTask = $null
    if ($null -eq $line) { break }

    $lines.Add($line)

    if ($line -match 'LitematicaBE enabled|display path') {
        if (-not $readySeen) {
            $readySeen = $true
            Say "    [mod ready] $line" 'Green'
            Start-Sleep -Seconds 8   # let the world finish loading first
            # "-File" joins array arguments with commas, so split them back.
            $flat = @()
            foreach ($c in $Commands) { foreach ($part in ($c -split ',')) { if ($part.Trim()) { $flat += $part.Trim() } } }
            foreach ($cmd in $flat) {
                Say "    [send] $cmd" 'DarkGray'
                $proc.StandardInput.WriteLine($cmd)
                $proc.StandardInput.Flush()
                Start-Sleep -Seconds 4
            }
            $commandsSent = $true
            # Keep reading for a while so the command output actually lands in the log,
            # then let the main loop expire.
            $deadline = (Get-Date).AddSeconds(10)
        }
    }
    elseif ($line -match 'Server started|IPv4 supported') {
        Say "    [server] $line" 'DarkGray'
    }
}

if (-not $readySeen) { Say '!!! LitematicaBE never reported a display path' 'Red' }
if (-not $commandsSent) { Say '!!! commands were never sent' 'Red' }

# ------------------------------------------------------------------- shut down
if (-not $KeepRunning -and -not $proc.HasExited) {
    Say '==> stopping server' 'Cyan'
    try { $proc.StandardInput.WriteLine('stop'); $proc.StandardInput.Flush() } catch { }
    if (-not $proc.WaitForExit(60000)) {
        Say '    force kill' 'Yellow'
        try { $proc.Kill() } catch { }
        $proc.WaitForExit(15000) | Out-Null
    }
}
if ($pendingTask -ne $null) {
    # drain whatever is left
    $extra = $null
    try { $extra = $proc.StandardOutput.ReadToEnd() } catch { }
    if ($extra) { foreach ($l in ($extra -split "`r?`n")) { if ($l) { $lines.Add($l) } } }
}
# Always drain again after shutdown so nothing is lost.
try {
    $rest = $proc.StandardOutput.ReadToEnd()
    if ($rest) { foreach ($l in ($rest -split "`r?`n")) { if ($l) { $lines.Add($l) } } }
} catch { }

$exitCode = if ($proc.HasExited) { $proc.ExitCode } else { 'running' }

# --------------------------------------------------------------------- report
Say ''
Say '================ STAGE A REPORT ================' 'Cyan'

$interesting = $lines | Where-Object {
    $_ -match 'LitematicaBE|HologramLib|display path|command /lit|packetId|lit probe|lit info|lit load|holo_core|====|>>>' `
    -or $_ -match '[a-z_]+:[a-z_\[\]=,\.0-9"]+'
}

Say "lines captured : $($lines.Count)"
Say "exit code      : $exitCode"
Say ''
Say '--- mod / command output ---' 'Cyan'
if ($interesting) { $interesting | ForEach-Object { Say $_ } } else { Say '(nothing matched)' 'Yellow' }

Say ''
Say '--- last 25 lines of the run ---' 'Cyan'
$lines | Select-Object -Last 25 | ForEach-Object { Say $_ }

$dump = Join-Path $ServerRoot '_stage_a_verify.log'
$lines | Set-Content -Path $dump -Encoding UTF8
Say ''
Say "full log: $dump" 'DarkGray'
