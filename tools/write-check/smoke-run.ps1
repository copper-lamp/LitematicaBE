# 在本地测试服上跑一遍「选区/保存」冒烟测试（控制台命令，不需要客户端）。
#
# 用法：
#   pwsh -File tools/write-check/smoke-run.ps1 -CommandsFile cmds.txt -Seconds 180
#
# 做三件事：启动 BDS（bedrock_server_mod.exe）→ 逐条发控制台命令 → 收尾抄下控制台日志。
# 命令文件里一行一条（写入 stdin，不需要前导斜杠）。

param(
    [string]$ServerDir = "C:\Users\25491\Desktop\MCBEserver1.21.132",
    [Parameter(Mandatory = $true)][string]$CommandsFile,
    [int]$BootTimeoutSeconds = 240,
    [int]$AfterCommandSeconds = 4,
    [int]$TailSeconds = 12
)

$ErrorActionPreference = 'Stop'

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName               = Join-Path $ServerDir 'bedrock_server_mod.exe'
$psi.WorkingDirectory       = $ServerDir
$psi.RedirectStandardInput  = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError  = $true
$psi.UseShellExecute        = $false
$psi.CreateNoWindow         = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8

$process = [System.Diagnostics.Process]::Start($psi)
Write-Host "[smoke] server pid $($process.Id)"

$transcript = [System.Text.StringBuilder]::new()
$deadline   = (Get-Date).AddSeconds($BootTimeoutSeconds)
$booted     = $false

while ((Get-Date) -lt $deadline) {
    $line = $process.StandardOutput.ReadLine()
    if ($null -eq $line) { break }
    [void]$transcript.AppendLine($line)
    if ($line -match 'Server started') { $booted = $true; break }
    if ($line -match 'LitematicaBE .* enabled') { $booted = $true }
}

[void]$transcript.AppendLine("### booted=$booted")

if ($booted) {
    foreach ($command in (Get-Content -Path $CommandsFile -Encoding UTF8)) {
        $trimmed = $command.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
        Write-Host "[smoke] > $trimmed"
        $process.StandardInput.WriteLine($trimmed)
        $process.StandardInput.Flush()
        Start-Sleep -Seconds $AfterCommandSeconds
    }

    $stopAt = (Get-Date).AddSeconds($TailSeconds)
    while ((Get-Date) -lt $stopAt) {
        if ($process.StandardOutput.Peek() -lt 0) { Start-Sleep -Milliseconds 300; continue }
        $line = $process.StandardOutput.ReadLine()
        if ($null -eq $line) { break }
        [void]$transcript.AppendLine($line)
    }

    $process.StandardInput.WriteLine('stop')
    $process.StandardInput.Flush()
}

if (-not $process.WaitForExit(60000)) {
    Write-Host '[smoke] force kill'
    $process.Kill()
}

$out = Join-Path $PSScriptRoot 'smoke-console.log'
Set-Content -Path $out -Value $transcript.ToString() -Encoding UTF8
Write-Host "[smoke] transcript -> $out (booted=$booted, exit=$($process.ExitCode))"
