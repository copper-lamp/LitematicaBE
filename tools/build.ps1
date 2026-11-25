#Requires -Version 5.1
<#
.SYNOPSIS
    LitematicaBE 构建脚本。

.DESCRIPTION
    两件事：
      1. 自动处理 ATL 缺失 —— 当前 MSVC 工具集里没有 atlmfc 时，把同一 VS 实例里其它
         工具集的 atlmfc 通过 CL / LIB / _LINK_ 注入给构建进程（只影响本次进程，不改系统）。
         这是为了让「只装了 v141 ATL」的机器也能构建；正解仍是安装 v143 的 ATL 组件。
      2. 调用 xmake 完成配置与构建。

.PARAMETER Mode
    release（默认）/ debug

.PARAMETER Reconfigure
    重新配置（xmake f -c），会清掉配置缓存。改过 xmake.lua 或依赖版本时用。

.PARAMETER Incremental
    只跑 xmake，不重新配置。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools/build.ps1
    powershell -ExecutionPolicy Bypass -File tools/build.ps1 -Mode debug -Reconfigure
#>
param(
    [ValidateSet('release', 'debug')]
    [string]$Mode = 'release',
    [switch]$Reconfigure,
    [switch]$Incremental
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'xmake.lua'))) {
    throw "找不到 xmake.lua，脚本应位于 <repo>/tools/ 下：$root"
}

function Get-VsInstance {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) {
        throw "找不到 vswhere.exe，未检测到 Visual Studio 安装。"
    }
    $path = & $vswhere -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ([string]::IsNullOrWhiteSpace($path)) {
        throw "vswhere 没找到带 C++ 工具集的 VS 实例。"
    }
    return $path.Trim()
}

function Resolve-Atl {
    param([string]$VsPath)

    $msvcRoot = Join-Path $VsPath 'VC\Tools\MSVC'
    if (-not (Test-Path $msvcRoot)) {
        throw "找不到 MSVC 工具集目录：$msvcRoot"
    }

    # 最新的工具集就是 xmake 会选的那个（按版本号排序）
    $toolsets = Get-ChildItem $msvcRoot -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending

    $current = $toolsets | Select-Object -First 1
    if (-not $current) {
        throw "MSVC 工具集目录为空：$msvcRoot"
    }

    $atlOf = {
        param($dir)
        $inc = Join-Path $dir.FullName 'atlmfc\include\atlbase.h'
        $lib = Join-Path $dir.FullName 'atlmfc\lib\x64\atls.lib'
        if ((Test-Path $inc) -and (Test-Path $lib)) { return $dir }
        return $null
    }

    $own = & $atlOf $current
    if ($own) {
        return [pscustomobject]@{
            Toolset   = $current.Name
            AtlFrom   = $current.Name
            NeedInject = $false
            Include   = Join-Path $current.FullName 'atlmfc\include'
            LibDir    = Join-Path $current.FullName 'atlmfc\lib\x64'
        }
    }

    $fallback = $null
    foreach ($toolset in $toolsets) {
        $candidate = & $atlOf $toolset
        if ($candidate) { $fallback = $toolset; break }
    }

    if (-not $fallback) {
        throw @"
当前工具集 $($current.Name) 缺少 C++ ATL，同一 VS 实例里也找不到可借用的 atlmfc。

请在 VS Installer 里安装：单个组件 → 搜索 v143 →
「适用于最新 v143 生成工具的 C++ ATL (x86 和 x64)」
（组件 ID：Microsoft.VisualStudio.Component.VC.ATL）
"@
    }

    return [pscustomobject]@{
        Toolset    = $current.Name
        AtlFrom    = $fallback.Name
        NeedInject = $true
        Include    = Join-Path $fallback.FullName 'atlmfc\include'
        LibDir     = Join-Path $fallback.FullName 'atlmfc\lib\x64'
    }
}

$vs = Get-VsInstance
$atl = Resolve-Atl -VsPath $vs

Write-Host "[build] VS          : $vs"
Write-Host "[build] 工具集      : $($atl.Toolset)"
if ($atl.NeedInject) {
    Write-Warning "当前工具集缺少 C++ ATL，借用 $($atl.AtlFrom) 的 atlmfc（仅本次进程生效）"
    Write-Warning "正解：VS Installer 安装「适用于最新 v143 生成工具的 C++ ATL」"
    $env:CL = "/I`"$($atl.Include)`""
    $env:LIB = "$($atl.LibDir);$env:LIB"
    $env:_LINK_ = "/LIBPATH:`"$($atl.LibDir)`""
} else {
    Write-Host "[build] ATL         : 当前工具集自带"
}

Push-Location $root
try {
    if (-not $Incremental) {
        $configureArgs = @('f', '-y', '-p', 'windows', '-a', 'x64', '-m', $Mode)
        if ($Reconfigure) { $configureArgs = @('f', '-c', '-y', '-p', 'windows', '-a', 'x64', '-m', $Mode) }
        Write-Host "[build] xmake $($configureArgs -join ' ')"
        & xmake @configureArgs
        if ($LASTEXITCODE -ne 0) { throw "xmake 配置失败（exit $LASTEXITCODE）" }
    }

    Write-Host "[build] xmake -y"
    & xmake -y
    if ($LASTEXITCODE -ne 0) { throw "xmake 构建失败（exit $LASTEXITCODE）" }

    $out = Join-Path $root 'bin'
    if (Test-Path $out) {
        Write-Host "[build] 产物："
        Get-ChildItem $out -Recurse -File | ForEach-Object {
            Write-Host ("         {0}  ({1:N0} bytes)" -f $_.FullName.Substring($root.Length + 1), $_.Length)
        }
    }
} finally {
    Pop-Location
}
