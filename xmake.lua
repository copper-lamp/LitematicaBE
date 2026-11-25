--[[
    LitematicaBE — Minecraft Bedrock 服务端投影插件（LeviLamina 原生模组）

    目标基线
      BDS          1.21.132.x
      LeviLamina   1.9.9（1.9.x 线）
      LSE          0.17.13（仅旧实现参考；新实现不依赖脚本引擎）
    前置
      HologramLib  头文件 + 导入库放在仓库根的 hologramlib/ 目录（不入库，见 README）
                   目录被 .gitignore 忽略；缺失时构建为「无前置」形态，运行期降级。

    构建
      xmake f -c -y -p windows -a x64 -m release
      xmake -y
]]

add_rules("mode.debug", "mode.release")

add_repositories("levimc-repo https://github.com/LiteLDev/xmake-repo.git")

option("levilamina_version")
    set_default("1.9.9")
    set_showmenu(true)
    set_description("LeviLamina 版本（默认 1.9.9）；留空表示使用 xmake-repo 的最新版本")
option_end()

option("hologramlib_dir")
    set_default("hologramlib")
    set_showmenu(true)
    set_description("HologramLib 前置目录（相对仓库根）")
option_end()

local ll_version = get_config("levilamina_version")
if ll_version and ll_version ~= "" then
    add_requires("levilamina " .. ll_version, {configs = {target_type = "server"}})
else
    add_requires("levilamina", {configs = {target_type = "server"}})
end

-- levilamina → cpr[ssl=y] → libcurl{libssh2=true, zlib=true} → zlib
-- libssh2 预编译包(vc14.42)链接的是 zlib 1.3.1，而 libcurl 的 zlib 依赖被解析成
-- latest(1.4)，导致 libcurl 源码构建时 ninja 引用「未安装的 zlib 1.3.1」路径。
-- add_requireconfs 无法锁定 cpr 的(动态 on_load 注入的) libcurl 依赖，因此改为在
-- CI 的 build.yml 里预装 zlib 1.3.1（见 Warm zlib 1.3.1 step）。

add_requires("levibuildscript")

-- gzip 解压：BDS 的 Core::Compression::Zlib 没有导出符号，用 miniz 单库解压。
add_requires("miniz")

if not has_config("vs_runtime") then
    set_runtimes("MD")
end

-- HologramLib 前置探测。两种常见布局都认：
--   hologramlib/include/hologramlib/*.h
--   hologramlib/hologramlib/*.h
-- 只有真的看到 hologramlib/HologramLib.h 才算找到了前置，避免空目录误判。
local hl_dir_name = get_config("hologramlib_dir")
if not hl_dir_name or hl_dir_name == "" then
    hl_dir_name = "hologramlib"
end

local project_root = os.projectdir()
local hl_dir = project_root .. "/" .. hl_dir_name
local hl_include = nil
if os.isfile(hl_dir .. "/include/hologramlib/HologramLib.h") then
    hl_include = hl_dir .. "/include"
elseif os.isfile(hl_dir .. "/hologramlib/HologramLib.h") then
    hl_include = hl_dir
end
local hl_libdir = hl_dir .. "/lib"

if hl_include then
    print("[LitematicaBE] HologramLib includes: " .. hl_include)
else
    print("[LitematicaBE] HologramLib not found under " .. hl_dir .. ", building without it")
end

target("LitematicaBE")
    -- 版本号与 src/LitematicaBE/Version.h、lip.toml、CHANGELOG 由 tools/lit_tools/version.py
    -- 一起校验（`python -m lit_tools version`），任何一处漂移都会让 CI 变红。
    add_rules("@levibuildscript/linkrule")
    add_rules("@levibuildscript/modpacker", {
        modName = "LitematicaBE",
        modVersion = "4.0.0",
        modPlatform = "server"
    })

    set_kind("shared")
    set_languages("c++20")
    set_symbols("debug")

    if is_plat("windows") then
        add_defines("NOMINMAX", "UNICODE", "_HAS_CXX23=1")
        set_exceptions("none") -- To avoid conflicts with /EHa.
        add_cxflags(
            "/EHa",
            "/utf-8",
            "/W4",
            "/w44265",
            "/w44289",
            "/w44296",
            "/w45263",
            "/w44738",
            "/w45204"
        )
        add_cxflags(
            "/EHs",
            "-Wno-microsoft-cast",
            "-Wno-invalid-offsetof",
            "-Wno-c++2b-extensions",
            "-Wno-microsoft-include",
            "-Wno-overloaded-virtual",
            "-Wno-ignored-qualifiers",
            "-Wno-missing-field-initializers",
            "-Wno-potentially-evaluated-expression",
            "-Wno-pragma-system-header-outside-header",
            {tools = {"clang_cl"}}
        )
        set_toolchains("clang-cl")
    end

    add_packages("levilamina")
    add_packages("miniz")

    -- 内置上传服务用 Winsock。
    if is_plat("windows") then
        add_syslinks("ws2_32")
    end

    add_headerfiles("src/**.h")
    add_files("src/**.cpp")
    add_includedirs("src")

    -- HologramLib：编译期直链（前置缺失时只定义宏，不 include 也不链接）
    if hl_include then
        add_defines("LITEMATICABE_WITH_HOLOGRAMLIB=1")
        add_includedirs(hl_include)
        if os.isdir(hl_libdir) then
            add_linkdirs(hl_libdir)
            local linked = 0
            for _, lib in ipairs(os.files(hl_libdir .. "/*.lib")) do
                add_links(path.basename(lib))
                linked = linked + 1
            end
            for _, lib in ipairs(os.files(hl_libdir .. "/*.a")) do
                add_links(path.basename(lib))
                linked = linked + 1
            end
            if linked == 0 then
                print("[LitematicaBE] warning: no .lib/.a in " .. hl_libdir .. ", link will fail")
            end
        else
            print("[LitematicaBE] warning: missing " .. hl_libdir .. ", link will fail")
        end

        -- 批量编码器（holo_core_encode_update_subchunk_blocks / holo_free）只在 holo_core.dll 里，
        -- HologramLib.lib 没有这些导入符号。按发布约定随插件分发这个 DLL；
        -- 同时把运行期映射表放进 data/，插件启动时从模组目录读。
        after_build(function (target)
            local src = hl_dir .. "/holo_core.dll"
            if os.isfile(src) then
                local targets = {
                    path.join(target:targetdir(), "holo_core.dll"),
                    path.join(os.projectdir(), "bin", target:name(), "holo_core.dll"),
                }
                for _, dst in ipairs(targets) do
                    local dir = path.directory(dst)
                    if dir and dir ~= "" then
                        os.mkdir(dir)
                    end
                    os.cp(src, dst)
                end
                print("[LitematicaBE] bundled holo_core.dll next to the plugin")
            else
                print("[LitematicaBE] warning: " .. src .. " not found, release will lack the batch encoder")
            end

            -- 运行期数据表：映射表 + 遮挡白名单（resources/data/*.json，不含 source/ 与 generated/）
            local dataFiles = os.files(path.join(os.projectdir(), "resources", "data", "*.json"))
            if #dataFiles > 0 then
                local dataDst = path.join(os.projectdir(), "bin", target:name(), "data")
                os.mkdir(dataDst)
                for _, file in ipairs(dataFiles) do
                    os.cp(file, path.join(dataDst, path.filename(file)))
                end
                print("[LitematicaBE] copied runtime data -> " .. dataDst)
            else
                print("[LitematicaBE] warning: no resources/data/*.json (run lit-tools mapgen / occlusion)")
            end
        end)
    else
        add_defines("LITEMATICABE_WITH_HOLOGRAMLIB=0")
    end
