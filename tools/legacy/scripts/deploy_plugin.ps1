# deploy_plugin.ps1 - 把仓库里的插件代码同步到 BDS 插件目录（幂等，可反复跑）
#
# 为什么需要它：手工拖拽最容易漏文件、也最容易用旧 zip 把 manifest.json 覆盖回旧版本号
# （日志里出现 "正在加载 LitematicaBE v3.0.0" 就是这么来的）。
#
# 用法：
#   & D:\GitHub\LitematicaBE\work\deploy_plugin.ps1
#   & D:\GitHub\LitematicaBE\work\deploy_plugin.ps1 -ServerRoot 'D:\bds' -KeepConfig
#
# 只同步"插件代码 + 运行时索引"；BP/RP 与世界记录由 deploy_addon.ps1 负责。

param(
    [string]$ServerRoot = 'C:\Users\25491\Desktop\MCBEserver1.21.132',
    [switch]$KeepConfig,          # 保留服务端现有 config.json（玩家改过的配置不覆盖）
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dep = Join-Path $ServerRoot 'plugins\LitematicaBE'

if (-not (Test-Path $dep)) { throw "插件目录不存在: $dep" }

function Sync-File([string]$rel, [switch]$SkipIfExists) {
    $src = Join-Path $repo $rel
    $dst = Join-Path $dep $rel
    if (-not (Test-Path $src)) { Write-Host "  ! 源文件缺失，跳过: $rel" -ForegroundColor Yellow; return }
    if ($SkipIfExists -and (Test-Path $dst)) { Write-Host "  = 保留现有: $rel" -ForegroundColor DarkGray; return }
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path $dir)) { if (-not $DryRun) { New-Item -ItemType Directory -Path $dir -Force | Out-Null } }
    if (-not $DryRun) { Copy-Item $src $dst -Force }
    Write-Host "  > $rel" -ForegroundColor Green
}

Write-Host "仓库 : $repo"
Write-Host "目标 : $dep"
if ($DryRun) { Write-Host "（DryRun：只打印，不写盘）" -ForegroundColor Cyan }

Write-Host "`n[1/4] 插件入口与清单" -ForegroundColor Cyan
Sync-File 'index.js'
Sync-File 'manifest.json'
Sync-File 'package.json'
Sync-File 'package-lock.json'
Sync-File 'config.json' -SkipIfExists:$KeepConfig

Write-Host "`n[2/4] src/" -ForegroundColor Cyan
$srcFiles = Get-ChildItem (Join-Path $repo 'src') -Recurse -File -Filter *.js
foreach ($f in $srcFiles) {
    $rel = 'src\' + $f.FullName.Substring((Join-Path $repo 'src').Length + 1)
    Sync-File $rel
}

Write-Host "`n[3/4] 运行时索引（resources/data -> data/）" -ForegroundColor Cyan
$dataDir = Join-Path $dep 'data'
if (-not $DryRun -and -not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
foreach ($n in @('ghost_index.json', 'addon_expected.json')) {
    $s = Join-Path $repo "resources\data\$n"
    if (-not (Test-Path $s)) { Write-Host "  ! 缺少 $n" -ForegroundColor Yellow; continue }
    if (-not $DryRun) { Copy-Item $s (Join-Path $dataDir $n) -Force }
    Write-Host "  > data\$n" -ForegroundColor Green
}

Write-Host "`n[4/4] 依赖检查" -ForegroundColor Cyan
$nm = Join-Path $dep 'node_modules\xlsx'
if (Test-Path $nm) {
    Write-Host "  = node_modules/xlsx 已存在" -ForegroundColor DarkGray
} else {
    Write-Host "  ! node_modules/xlsx 缺失：在 $dep 下执行 npm ci --omit=dev（MaterialCounter 需要它）" -ForegroundColor Yellow
}

Write-Host "`n完成。重启 BDS 生效。" -ForegroundColor Cyan
Write-Host "校验：node work\verify_deploy.js" -ForegroundColor DarkGray
