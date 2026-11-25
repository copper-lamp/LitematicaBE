# deploy_addon.ps1 — 把仓库里的 ghost addon 与运行时数据同步到 BDS（只动 addon + data，不动插件代码）
#
# 用法：
#   pwsh -File work\deploy_addon.ps1
#   pwsh -File work\deploy_addon.ps1 -ServerRoot 'D:\other\BDS' -WorldName 'MyWorld'
#
# 做的事（幂等，可反复跑）：
#   1. resources/data/ghost_index.json、addon_expected.json  -> plugins/LitematicaBE/data/
#   2. resources/addon/LitematicaBE_BP|RP                    -> behavior_packs|resource_packs/<现有目录名>
#      （目录名自动探测：优先 server-BP/RP，其次 _BP/_RP；旧包复制到 backup/，不移动，BDS 运行中也安全）
#   3. 世界记录 world_behavior_packs.json / world_resource_packs.json 的版本号对齐到 addon_expected
#   4. 末尾调用 work/verify_deploy.js 做完整性校验
#
# 插件代码（index.js、src/、manifest.json）不在这里同步，避免覆盖别人的 config.json。

param(
    [string]$ServerRoot = 'C:\Users\25491\Desktop\MCBEserver1.21.132',
    [string]$WorldName  = 'NIEserver'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Say($msg) { Write-Host "[deploy] $msg" }

if (-not (Test-Path $ServerRoot)) { throw "ServerRoot not found: $ServerRoot" }

$plugDir = Join-Path $ServerRoot 'plugins\LitematicaBE'
if (-not (Test-Path $plugDir)) { throw "plugin dir not found: $plugDir" }

# ---------- 0. 运行状态提示 ----------
$bds = Get-Process -Name 'bedrock_server*' -ErrorAction SilentlyContinue
if ($bds) {
    Say "注意：BDS 正在运行（PID $($bds.Id -join ',')），覆盖的包/数据要重启服务器才生效"
}

# ---------- 1. data ----------
$dataDst = Join-Path $plugDir 'data'
New-Item -ItemType Directory -Force $dataDst | Out-Null
Copy-Item (Join-Path $RepoRoot 'resources\data\ghost_index.json')    $dataDst -Force
Copy-Item (Join-Path $RepoRoot 'resources\data\addon_expected.json') $dataDst -Force
Say 'data/ 已同步（ghost_index.json + addon_expected.json）'

$expected = Get-Content (Join-Path $dataDst 'addon_expected.json') -Raw | ConvertFrom-Json
$addonVer = @($expected.addonVersion)
$verText  = ($addonVer -join '.')

# ---------- 2. BP / RP ----------
# 现网目录名可能是 LitematicaBE-server-BP/RP，也可能被改成 LitematicaBE_BP/RP（历史部署），
# 直接写死任一种都会把包装成第二份、BDS 同时扫到两个版本 → 版本校验永远不过。
function Pick-PackDest([string]$kind, [string[]]$candidates) {
    $base = Join-Path $ServerRoot $kind
    foreach ($c in $candidates) {
        $p = Join-Path $base $c
        if (Test-Path $p) { return @{ Path = $p; Name = $c } }
    }
    return @{ Path = (Join-Path $base $candidates[0]); Name = $candidates[0] }
}

$bpDest = Pick-PackDest 'behavior_packs' @('LitematicaBE-server-BP', 'LitematicaBE_BP')
$rpDest = Pick-PackDest 'resource_packs'  @('LitematicaBE-server-RP', 'LitematicaBE_RP')

$backupDir = Join-Path $ServerRoot ("backup\addon-old-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$pairs = @(
    @{ Src = Join-Path $RepoRoot 'resources\addon\LitematicaBE_BP'; Dst = $bpDest.Path; Name = $bpDest.Name },
    @{ Src = Join-Path $RepoRoot 'resources\addon\LitematicaBE_RP'; Dst = $rpDest.Path; Name = $rpDest.Name }
)

foreach ($p in $pairs) {
    if (-not (Test-Path $p.Src)) { throw "missing source pack: $($p.Src)" }
    if (Test-Path $p.Dst) {
        $mf = Join-Path $p.Dst 'manifest.json'
        $oldVer = 'unknown'
        if (Test-Path $mf) {
            try { $oldVer = (@((Get-Content $mf -Raw | ConvertFrom-Json).header.version) -join '.') } catch { }
        }
        if ($oldVer -ne $verText) {
            # 只复制备份、不移动目录：BDS 运行时 Move 会因占用失败，且半途失败会留下半个包
            New-Item -ItemType Directory -Force $backupDir | Out-Null
            $bak = Join-Path $backupDir ("$($p.Name).old-$oldVer")
            if (-not (Test-Path $bak)) {
                $null = robocopy $p.Dst $bak /E /NFL /NDL /NJH /NJS /NP /R:0 /W:0
            }
            Say "$($p.Name) 旧版本 $oldVer → 已备份到 backup/$(Split-Path $backupDir -Leaf)/$($p.Name).old-$oldVer"
        }
    }
    $null = robocopy $p.Src $p.Dst /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $($p.Dst): $LASTEXITCODE" }

    # robocopy /E 只覆盖+新增，不会删掉源里已移除的文件。活塞改成「每朝向一个 identifier」后，
    # 旧的无后缀文件（g_piston_head.json / lit_piston_extended.json …）会留在目标目录里，
    # 变成一堆引用了不存在几何的空壳方块。这里按名字精确清掉已知的废弃活塞文件。
    $staleBp = @('g_piston_side', 'g_sticky_piston', 'g_piston_side_extended',
        'g_sticky_piston_extended', 'g_piston_head', 'g_sticky_piston_head',
        # 半砖/形态批次重构后变成孤儿的旧整块模型（index 里已无条目）
        'g_oak_trapdoor', 'g_oak_door', 'g_daylight_detector_top') |
        ForEach-Object { Join-Path $p.Dst "blocks\$_.json" }
    $staleRp = @('lit_piston', 'lit_piston_extended', 'lit_piston_head') |
        ForEach-Object { Join-Path $p.Dst "models\blocks\$_.json" }
    # 旧的分贴图 / 旧图集版本：robocopy 只增不删，这里按名字精确清掉
    $staleRp += @('ghost_piston_arm1', 'ghost_piston_arm2', 'ghost_piston_arm_cap', 'ghost_piston_plate_back_sticky',
        'ghost_piston_atlas', 'ghost_piston_atlas_sticky',
        'ghost_piston_inner', 'ghost_piston_arm_stub_a', 'ghost_piston_arm_stub_b',
        'ghost_piston_plate_top_sticky') |
        ForEach-Object { Join-Path $p.Dst "textures\blocks\ghost\$_.png" }
    $removed = 0
    foreach ($f in ($staleBp + $staleRp)) {
        if (Test-Path $f) { Remove-Item $f -Force; $removed++ }
    }
    if ($removed -gt 0) { Say "$($p.Name) 已清理 $removed 个废弃活塞模型文件" }

    $n = (Get-ChildItem $p.Dst -Recurse -File | Measure-Object).Count
    Say "$($p.Name) 已写入 $verText（$n 个文件）"
}

# 清掉"另一个可能的目录名"下同 uuid 的旧包，避免 BDS 同时扫描到两份同 uuid 不同版本的包
foreach ($kind in @('behavior_packs', 'resource_packs')) {
    $base = Join-Path $ServerRoot $kind
    $keep = if ($kind -eq 'behavior_packs') { $bpDest.Name } else { $rpDest.Name }
    foreach ($d in (Get-ChildItem $base -Directory -ErrorAction SilentlyContinue)) {
        if ($d.Name -eq $keep) { continue }
        if ($d.Name -notlike 'LitematicaBE*') { continue }
        Say "警告：$kind\$($d.Name) 也像本插件的包，两包同 uuid 会导致版本校验错配，请手工确认后删除"
    }
}

# ---------- 3. 世界记录版本对齐 ----------
$worldDir = Join-Path $ServerRoot "worlds\$WorldName"
if (Test-Path $worldDir) {
    $maps = @(
        @{ File = 'world_behavior_packs.json'; Uuid = $expected.bpUuid },
        @{ File = 'world_resource_packs.json'; Uuid = $expected.rpUuid }
    )
    foreach ($m in $maps) {
        $f = Join-Path $worldDir $m.File
        if (-not (Test-Path $f)) { Say "$($m.File) 不存在，跳过"; continue }
        $raw = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
        $list = $raw | ConvertFrom-Json
        $entry = $list | Where-Object { $_.pack_id -eq $m.Uuid }
        if (-not $entry) { Say "$($m.File) 未引用 $(($m.Uuid).Substring(0,8))…，跳过"; continue }
        $old = (@($entry.version) -join '.')
        if ($old -eq $verText) { Say "$($m.File) 已是 $verText"; continue }
        # 只替换该条目的旧版本字面量，避免动到别的包（世界文件里版本数组的空白写法不固定）
        # 注意：替换串必须写 ${1}/${2}。写成 '$1' + '1, 1, 49' 会被 .NET 拼成 "$11, 1, 49"，
        # 然后再被当成"第 11 个捕获组"，结果把 JSON 写成 `$11, 1, 49]`（已踩过一次）。
        $oldNums = @($entry.version) -join '\s*,\s*'
        $pattern = '("pack_id"\s*:\s*"' + [regex]::Escape($m.Uuid) + '"[\s\S]{0,200}?"version"\s*:\s*\[)\s*' + $oldNums + '\s*(\])'
        $newLit = '${1}' + (($addonVer | ForEach-Object { "$_" }) -join ', ') + '${2}'
        $newRaw = [regex]::Replace($raw, $pattern, $newLit)
        if ($newRaw -eq $raw) {
            Say "$($m.File) 版本替换失败（$old → $verText），请手工确认"
        } else {
            [IO.File]::WriteAllText($f, $newRaw, (New-Object Text.UTF8Encoding($false)))
            Say "$($m.File) 版本 $old → $verText"
        }
    }
} else {
    Say "世界目录不存在: $worldDir（跳过记录对齐）"
}

# ---------- 4. 校验 ----------
Say '开始完整性校验…'
& node (Join-Path $RepoRoot 'work\verify_deploy.js')
exit $LASTEXITCODE
