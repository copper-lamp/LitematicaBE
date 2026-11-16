# -*- coding: utf-8 -*-
"""生成 LitematicaBE 用户使用文档 (docx)。"""
import datetime
from docx import Document
from docx.shared import Pt, Cm, RGBColor, Emu, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

PRIMARY = RGBColor(0x2E, 0x5F, 0xA3)   # 主色深蓝
ACCENT = RGBColor(0x4C, 0x8B, 0xF5)    # 强调蓝
DARK = RGBColor(0x26, 0x26, 0x26)      # 正文深灰
GRAY = RGBColor(0x66, 0x66, 0x66)      # 次要灰
CODE_BG = "F2F4F8"
CODE_TXT = RGBColor(0x1F, 0x29, 0x37)

EAST = "微软雅黑"
ASCII_FONT = "Microsoft YaHei"
MONO = "Consolas"

doc = Document()

# ---------- 页面与默认样式 ----------
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.top_margin = Cm(2.4)
sec.bottom_margin = Cm(2.2)
sec.left_margin = Cm(2.6)
sec.right_margin = Cm(2.6)
CONTENT_W = Cm(21.0 - 2.6 - 2.6)

normal = doc.styles["Normal"]
normal.font.name = ASCII_FONT
normal.font.size = Pt(10.5)
normal.font.color.rgb = DARK
normal.element.rPr.rFonts.set(qn("w:eastAsia"), EAST)
pf = normal.paragraph_format
pf.line_spacing = 1.35
pf.space_after = Pt(6)


def set_east(run, east=EAST):
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), east)


def style_heading(name, size, color, bold=True, space_before=14, space_after=8):
    st = doc.styles[name]
    st.font.name = ASCII_FONT
    st.font.size = Pt(size)
    st.font.bold = bold
    st.font.color.rgb = color
    st.element.rPr.rFonts.set(qn("w:eastAsia"), EAST)
    st.paragraph_format.space_before = Pt(space_before)
    st.paragraph_format.space_after = Pt(space_after)
    st.paragraph_format.line_spacing = 1.2
    return st


style_heading("Title", 28, PRIMARY, space_before=0, space_after=10)
style_heading("Heading 1", 18, PRIMARY, space_before=18, space_after=10)
style_heading("Heading 2", 14, ACCENT, space_before=14, space_after=8)
style_heading("Heading 3", 12, PRIMARY, space_before=12, space_after=6)


# 代码样式
code_style = doc.styles.add_style("CodeBlock", 1)
code_style.font.name = MONO
code_style.font.size = Pt(9)
code_style.font.color.rgb = CODE_TXT
code_style.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
code_style.paragraph_format.space_before = Pt(4)
code_style.paragraph_format.space_after = Pt(4)
code_style.paragraph_format.line_spacing = 1.1
code_style.paragraph_format.left_indent = Cm(0.2)


def shade_paragraph(p, fill=CODE_BG):
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pPr.append(shd)


def add_code(lines):
    if isinstance(lines, str):
        lines = lines.split("\n")
    for ln in lines:
        p = doc.add_paragraph(ln, style="CodeBlock")
        shade_paragraph(p)
        p.paragraph_format.left_indent = Cm(0.3)
        p.paragraph_format.right_indent = Cm(0.2)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def para(text="", bold=False, size=10.5, color=None, align=None, space_after=6):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.name = ASCII_FONT
    set_east(r)
    if color is not None:
        r.font.color.rgb = color
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    return p


def rich(segments, align=None, space_after=6, style=None):
    """segments: list of (text, dict) 其中 dict 可含 bold/code/color/size"""
    p = doc.add_paragraph(style=style)
    for text, opts in segments:
        r = p.add_run(text)
        r.font.size = Pt(opts.get("size", 10.5))
        r.font.bold = opts.get("bold", False)
        if opts.get("code"):
            r.font.name = MONO
            r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), "微软雅黑")
            r.font.size = Pt(9.5)
            r.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)
        else:
            r.font.name = ASCII_FONT
            set_east(r)
            r.font.color.rgb = opts.get("color", DARK)
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    return p


def bullet(text, bold_prefix=None):
    p = doc.add_paragraph(style="List Bullet")
    if bold_prefix:
        r = p.add_run(bold_prefix)
        r.font.bold = True
        r.font.size = Pt(10.5)
        r.font.name = ASCII_FONT
        set_east(r)
    r = p.add_run(text)
    r.font.size = Pt(10.5)
    r.font.name = ASCII_FONT
    set_east(r)
    p.paragraph_format.space_after = Pt(3)
    return p


def numbered(text, bold_prefix=None):
    p = doc.add_paragraph(style="List Number")
    if bold_prefix:
        r = p.add_run(bold_prefix)
        r.font.bold = True
        r.font.size = Pt(10.5)
        r.font.name = ASCII_FONT
        set_east(r)
    r = p.add_run(text)
    r.font.size = Pt(10.5)
    r.font.name = ASCII_FONT
    set_east(r)
    p.paragraph_format.space_after = Pt(3)
    return p


def make_table(headers, rows, widths=None, header_fill="2E5FA3"):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        cell = hdr[i]
        cell.text = ""
        p = cell.paragraphs[0]
        r = p.add_run(h)
        r.font.bold = True
        r.font.size = Pt(10)
        r.font.name = ASCII_FONT
        set_east(r)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:fill"), header_fill)
        tcPr.append(shd)
        cell.vertical_alignment = 1
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cell = cells[i]
            cell.text = ""
            p = cell.paragraphs[0]
            r = p.add_run(str(val))
            r.font.size = Pt(9.5)
            r.font.name = ASCII_FONT
            set_east(r)
            p.paragraph_format.space_after = Pt(2)
            cell.vertical_alignment = 1
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = w
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def callout(title, text, fill="FFF7E6", bar="F5A623"):
    t = doc.add_table(rows=1, cols=1)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = t.rows[0].cells[0]
    cell.width = CONTENT_W
    cell.text = ""
    p = cell.paragraphs[0]
    r = p.add_run(title)
    r.font.bold = True
    r.font.size = Pt(10)
    r.font.name = ASCII_FONT
    set_east(r)
    r.font.color.rgb = RGBColor(0x8A, 0x5A, 0x00)
    p2 = cell.add_paragraph()
    r2 = p2.add_run(text)
    r2.font.size = Pt(9.5)
    r2.font.name = ASCII_FONT
    set_east(r2)
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def add_toc():
    p = doc.add_paragraph()
    fldChar = OxmlElement("w:fldChar")
    fldChar.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\o "1-2" \\h \\z \\u'
    fldChar2 = OxmlElement("w:fldChar")
    fldChar2.set(qn("w:fldCharType"), "separate")
    t = OxmlElement("w:t")
    t.text = "（在 Word 中右键此处 → 更新域，即可生成目录）"
    fldChar3 = OxmlElement("w:fldChar")
    fldChar3.set(qn("w:fldCharType"), "end")
    r = p.add_run()
    r._r.append(fldChar)
    r._r.append(instr)
    r._r.append(fldChar2)
    r2 = p.add_run()
    r2._r.append(t)
    r3 = p.add_run()
    r3._r.append(fldChar3)
    for rr in (r, r2, r3):
        rr.font.size = Pt(10)
        rr.font.name = ASCII_FONT
        set_east(rr)


# 打开文档自动更新域（目录/页码）
settings = doc.settings.element
upd = OxmlElement("w:updateFields")
upd.set(qn("w:val"), "true")
settings.append(upd)


# ========== 页眉页脚 ==========
hdr = sec.header.paragraphs[0]
hdr.text = ""
hr = hdr.add_run("LitematicaBE 用户使用文档")
hr.font.size = Pt(8.5)
hr.font.name = ASCII_FONT
set_east(hr)
hr.font.color.rgb = GRAY
hdr.alignment = WD_ALIGN_PARAGRAPH.RIGHT

ftr = sec.footer.paragraphs[0]
ftr.text = ""
ftr.alignment = WD_ALIGN_PARAGRAPH.CENTER
# 页码域
fp = ftr.add_run()
fld1 = OxmlElement("w:fldChar"); fld1.set(qn("w:fldCharType"), "begin")
instr1 = OxmlElement("w:instrText"); instr1.set(qn("xml:space"), "preserve"); instr1.text = "PAGE"
fld2 = OxmlElement("w:fldChar"); fld2.set(qn("w:fldCharType"), "end")
fp._r.append(fld1); fp._r.append(instr1); fp._r.append(fld2)
fp.font.size = Pt(9)
fp.font.name = ASCII_FONT
set_east(fp)
fp.font.color.rgb = GRAY


# =====================================================
# 封面
# =====================================================
for _ in range(2):
    doc.add_paragraph()
try:
    pic_p = doc.add_paragraph()
    pic_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pic_p.add_run().add_picture("resources/pack_icon.png", width=Cm(5.2))
except Exception:
    pass

tp = doc.add_paragraph()
tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
tr = tp.add_run("LitematicaBE")
tr.font.size = Pt(42)
tr.font.bold = True
tr.font.name = ASCII_FONT
set_east(tr)
tr.font.color.rgb = PRIMARY

sp = doc.add_paragraph()
sp.alignment = WD_ALIGN_PARAGRAPH.CENTER
sr = sp.add_run("用户使用文档")
sr.font.size = Pt(22)
sr.font.bold = True
sr.font.name = ASCII_FONT
set_east(sr)
sr.font.color.rgb = ACCENT

sp2 = doc.add_paragraph()
sp2.alignment = WD_ALIGN_PARAGRAPH.CENTER
sr2 = sp2.add_run("基岩版服务器一站式投影集成 · 上手指引")
sr2.font.size = Pt(13)
sr2.font.name = ASCII_FONT
set_east(sr2)
sr2.font.color.rgb = GRAY
sp2.paragraph_format.space_after = Pt(20)

# 分隔线
line_p = doc.add_paragraph()
line_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
lr = line_p.add_run("─" * 40)
lr.font.color.rgb = ACCENT
lr.font.size = Pt(10)

info = [
    ("插件版本", "v3.1.0"),
    ("适用平台", "Minecraft Bedrock Server 1.21.70+ / LeviLamina 1.2.0+"),
    ("运行环境", "LegacyScriptEngine（nodejs 变体）0.11.0+"),
    ("许可证", "AGPL-3.0"),
    ("文档日期", datetime.date.today().strftime("%Y 年 %m 月 %d 日")),
]
for k, v in info:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = p.add_run(f"{k}：")
    r1.font.size = Pt(10.5)
    r1.font.bold = True
    r1.font.name = ASCII_FONT
    set_east(r1)
    r1.font.color.rgb = PRIMARY
    r2 = p.add_run(v)
    r2.font.size = Pt(10.5)
    r2.font.name = ASCII_FONT
    set_east(r2)
    r2.font.color.rgb = DARK
    p.paragraph_format.space_after = Pt(2)

doc.add_page_break()

# =====================================================
# 目录
# =====================================================
doc.add_heading("目录", level=1)
add_toc()
doc.add_page_break()

# =====================================================
# 1. 插件简介
# =====================================================
doc.add_heading("1. 插件简介", level=1)

doc.add_heading("1.1 这是什么", level=2)
rich([
    ("LitematicaBE", {"bold": True, "color": PRIMARY, "size": 11}),
    (" 是面向基岩版（BDS + LeviLamina）服务端的投影集成插件，借鉴并延续了 Java 版 ", {}),
    ("Litematica", {"bold": True}),
    (" 模组的投影理念，为基岩版服务器提供", {}),
    ("一站式投影服务", {"bold": True}),
    ("。", {}),
])
para("插件由「服务端插件 + BP/RP 扩展包」两部分组成，全部内容装载在服务端，玩家进入服务器时由客户端自动接收资源包，无需任何客户端安装。它同时支持读取 Java 版的 .litematic 与基岩版的 .mcstructure 两种结构文件，采用 geometry 原生自定义方块渲染投影，并提供逐层建造、轻松放置、投影打印机、直接放置、材料清单导出、Mega 超大型投影等实用功能。")

callout("核心定位",
        "投影（原理图）在 Java 版生态中广泛用于建筑规划与批量建造。LitematicaBE 把这套工作流原样搬到基岩版服务器：加载结构 → 半透明预览 → 逐层建造 / 自动放置 → 导出可互通的原理图文件。")

doc.add_heading("1.2 功能特性", level=2)
make_table(
    ["功能", "说明"],
    [
        ["原理图加载", "支持加载 Java 版 .litematic 或基岩版 .mcstructure 文件"],
        ["原理图保存", "把选区保存为 .litematic（与 Java 版 Litematica mod 互通）或基岩版 .mcstructure（可直接用结构方块加载）；导出时可选格式，也可两者同时导出"],
        ["投影放置", "geometry 方块原生渲染，半透明显示，最贴近原版观感"],
        ["逐层建造", "手持木剑右键切换显示，抬头看上层 / 低头看下层"],
        ["轻松放置", "手持材料对准投影即可精确放置"],
        ["投影打印机", "开启后自动打印范围内投影，可限速、可逐层"],
        ["直接放置", "OP + 创造模式把投影直接写入世界（NBT 直放）"],
        ["投影管理", "多投影同时储存，全服玩家共享可见，自由切换控制，支持材料清单导出"],
        ["Mega 投影", "分块存储、流式加载，最高可支持百万级超大型投影加载"],
        ["HTTP 上传站", "插件内置 HTTP 服务器，允许全体玩家自助上传投影文件，且无需重启即生效"],
        ["更新检查", "插件激活时自动检查仓库并提示新版本（可在 config 关闭该功能）"],
    ],
    widths=[Cm(3.6), Cm(12.2)],
)

doc.add_heading("1.3 兼容性要求", level=2)
make_table(
    ["组件", "版本要求"],
    [
        ["Minecraft Bedrock Server", "1.21.70+"],
        ["LeviLamina", "1.2.0+"],
        ["LegacyScriptEngine（nodejs 变体）", "0.11.0+"],
        ["LitematicaBE 插件 / addon", "随 Release 一同发布"],
    ],
    widths=[Cm(8.0), Cm(7.8)],
)
para("提示：本插件对服务端版本不敏感，上表为理论兼容范围；若在实际环境遇到兼容问题，欢迎向开发者反馈处理。", size=9.5, color=GRAY)

# =====================================================
# 2. 快速安装
# =====================================================
doc.add_heading("2. 快速安装", level=1)

doc.add_heading("2.1 安装 lip（推荐）", level=2)
para("lip 是 LeviLamina 生态的包管理器。若尚未安装，请先执行：")
add_code("npm install -g @levimc/lip")

doc.add_heading("2.2 使用 lip 安装插件", level=2)
para("在 BDS 服务端根目录执行：")
add_code("lip install github.com/copper-lamp/LitematicaBE")
para("安装完成后：")
bullet("插件本体安装到 plugins/LitematicaBE/；")
bullet("BP/RP 扩展包分别安装到 behavior_packs/ 与 resource_packs/。")

para("推荐锁定具体版本（以 v3.1.0 为例）：", space_after=3)
add_code("lip install github.com/copper-lamp/LitematicaBE@3.1.0")
para("升级使用：", space_after=3)
add_code("lip update github.com/copper-lamp/LitematicaBE")

doc.add_heading("2.3 手动安装（不使用 lip）", level=2)
para("从 Release 页面下载 LitematicaBE-<版本>.zip，然后：")
numbered("将 zip 内的 plugins/LitematicaBE/ 解压到 BDS 的 plugins/ 目录；")
numbered("将 LitematicaBE-server-BP/、LitematicaBE-server-RP/ 分别放到 BDS 的 behavior_packs/ 与 resource_packs/；")
numbered("按 2.4 节在世界中启用扩展包，然后重启服务器。")

doc.add_heading("2.4 启用 BP/RP 扩展包", level=2)
para("扩展包需要在世界中启用。把 BP/RP 的 pack_id（header.uuid）与 version 写入世界存档的 world_behavior_packs.json 与 world_resource_packs.json（或在存档设置中启用后上传存档至服务端），然后重启服务器：")
add_code("""[
  { "pack_id": "<BP 的 header.uuid>", "version": [1, 1, 8] }
]""")
callout("注意", "目录名是 behavior_packs / resource_packs（美式拼写）。插件与服务端 addon（BP/RP）必须为同批版本，否则 ghost 写入会被禁用。")

doc.add_heading("2.5 放入结构文件", level=2)
para("加载投影前，需要先把 .litematic / .mcstructure 文件放到插件目录：")
bullet("服务器管理员：手动放入 plugins/LitematicaBE/schematics/；", bold_prefix="")
bullet("普通玩家：通过插件内置的网页上传站上传（见第 5 节），上传后无需重启即可用。")

# =====================================================
# 3. 快速上手指引
# =====================================================
doc.add_page_break()
doc.add_heading("3. 快速上手指引", level=1)
para("本部分带你用最短路径完成一次投影的加载、查看与建造。")

doc.add_heading("3.1 三步开始使用", level=2)
numbered("把 .litematic 或 .mcstructure 文件放进 plugins/LitematicaBE/schematics/（或通过网页上传站上传）；", bold_prefix="第一步：")
numbered("手持木剑，蹲下并点击打开 LitematicaBE 主菜单，点击「加载投影」并选择文件；", bold_prefix="第二步：")
numbered("在放置面板调整坐标，提交后投影便显示在目标位置。", bold_prefix="第三步：")

doc.add_heading("3.2 操作方式一览", level=2)
make_table(
    ["操作", "说明"],
    [
        ["手持木剑 + 蹲下 + 点击", "打开主菜单"],
        ["抬头 / 低头 + 木剑右键", "建造模式时切换显示层"],
        ["平视 + 木剑点击", "切换显示全部层"],
        ["/lit 或 /litematica", "命令系统入口"],
    ],
    widths=[Cm(6.4), Cm(9.4)],
)

doc.add_heading("3.3 加载与放置投影", level=2)
para("用命令方式加载与放置：")
add_code("""/litematica load <file>       # 加载原理图
/litematica place <file>      # 加载并在脚下放置投影
/litematica placeat X Y Z     # 在指定坐标放置投影
/lit placeat ~ ~ ~            # 支持相对坐标（相对于玩家当前位置）""")
rich([
    ("提示：", {"bold": True}),
    ("place", {"code": True}),
    (" 默认把投影放在玩家脚下（", {}),
    ("玩家坐标 Y-1", {"code": True}),
    ("）；", {}),
    ("placeat", {"code": True}),
    (" 支持绝对坐标与 ", {}),
    ("~ ~5 ~-3", {"code": True}),
    (" 形式的相对坐标。", {}),
])

doc.add_heading("3.4 逐层建造", level=2)
numbered("在投影操作面板中开启「逐层显示」；")
numbered("手持木剑右键：抬头切到上一层，低头切到下一层，平视切回全部层。")
rich([("也可用命令切换到建造模式：", {}), ("/litematica build", {"code": True})])

doc.add_heading("3.5 轻松放置", level=2)
para("轻松放置让玩家手持对应材料对准投影即可精确放置，是手动建造的得力助手：")
numbered("在投影操作面板开启「轻松放置」，手持材料对准投影即可精确放置；")
numbered("同时具备「投影打印机」功能（/litematica printer 或 /lit printer），再次点击菜单可关闭。")
callout("打印机规则",
        "打印机只填充 ghost / 空气 / 花草雪水这类可替换方块，不会覆盖其它方块；逐层模式下只放当前层。")

doc.add_heading("3.6 投影打印机", level=2)
para("投影打印机是自动化的放置工具：开启后按一定速率自动把投影内的方块放置到世界，可限速、可逐层。")
para("命令切换：")
add_code("/litematica printer     # 或 /lit printer（切换开关）")
para("打印机的搜索半径、每轮放置数、放置间隔、是否顶掉可替换方块等，均可通过 config.json 的 easyPlace.printer 配置（见 6.2 节）。")

doc.add_heading("3.7 直接放置（管理员）", level=2)
para("如需把整个投影一次性写入世界（无需手工建造），使用直接放置功能：")
numbered("需要 OP 权限 + 创造模式；")
numbered("在「投影管理」中选择已放置的投影并进入详情，点击「直接放置全部方块」。")
rich([("该功能以 NBT 直放方式写入世界，属于", {}), ("高风险操作", {"bold": True}), ("，请先备份存档。", {})], space_after=4)

doc.add_heading("3.8 保存原理图", level=2)
para("把当前世界中的选区保存为可复用的原理图文件：")
numbered("打开菜单点击「保存投影」，点击「开始选区」，用木剑右键选取两个对角点；")
numbered("选区完成后在表单顶部的「导出格式」里选择：.litematic（Java 版投影文件）/ .mcstructure（基岩版结构文件）/ 两者都导出；")
numbered("输入名称与描述（可选）即可保存。")
rich([
    ("兼容说明：", {"bold": True}),
    ("以 ", {}),
    (".litematic", {"code": True}),
    (" 格式导出可与 Java 版 Litematica mod 互通；以 ", {}),
    (".mcstructure", {"code": True}),
    (" 格式导出可直接用结构方块加载。", {}),
])

doc.add_heading("3.9 验证投影", level=2)
para("建造前先验证，可以快速知道哪些方块需要补放：")
para("放置投影后，在投影操作面板点击「验证投影」，系统会报告匹配 / 差异 / 缺失 / 错误方块。")
add_code("/litematica verify   # 验证方块放置正确性")

doc.add_heading("3.10 材料清单导出", level=2)
para("需要统计建造材料时，可用材料清单功能生成 Excel 报表：")
add_code("/litematica materials   # 生成材料清单 Excel")

doc.add_heading("3.11 多投影管理", level=2)
para("插件支持同一玩家同时管理多个投影：")
bullet("列出所有投影：/litematica list；")
bullet("查看投影信息：/litematica info；")
bullet("移除某个投影：/litematica remove <名称>；")
bullet("清除当前投影显示：/litematica clear（只清主控投影；想只清一个请用「投影操作 → 卸载某个投影」）；")
bullet("切换主控投影：在菜单中设置（换主控只换指针，不重铺、不撤会话）。")

# =====================================================
# 4. 命令速查
# =====================================================
doc.add_page_break()
doc.add_heading("4. 命令速查", level=1)
para("以下命令均可通过手持木剑打开主菜单进行可视化操作。所有命令都支持 /litematica 与 /lit 两种写法（行为一致）。")

doc.add_heading("4.1 基础命令", level=2)
make_table(
    ["命令", "说明"],
    [
        ["/litematica menu", "打开主菜单"],
        ["/litematica load <file>", "加载原理图"],
        ["/litematica place <file>", "加载并在脚下放置投影"],
        ["/litematica placeat X Y Z", "在指定坐标放置投影（支持 ~ 相对坐标）"],
        ["/litematica rotate", "切换到旋转模式（木剑点击旋转投影）"],
        ["/litematica build", "切换到建造（逐层）模式"],
        ["/litematica easyplace", "切换轻松放置"],
        ["/litematica printer", "切换投影打印机（也可用 /lit printer）"],
        ["/litematica correction", "切换纠错放置模式"],
        ["/litematica verify", "验证方块放置正确性"],
        ["/litematica materials", "生成材料清单 Excel"],
        ["/litematica save", "打开保存原理图菜单（选区模式）"],
        ["/litematica select", "打开选区工具"],
        ["/litematica list", "列出所有投影"],
        ["/litematica remove <名称>", "移除指定投影"],
        ["/litematica info", "查看投影详细信息"],
        ["/litematica clear", "清除当前投影显示"],
        ["/litematica failures", "查看放置失败列表"],
        ["/litematica debug <sub>", "调试命令（mega/stats/config）"],
        ["/litematica selfcheck", "投影生成流程自检"],
        ["/litematica web", "查看 HTTP 上传站状态"],
        ["/litematica ghost ...", "ghost 运维（见 4.3 节）"],
    ],
    widths=[Cm(6.2), Cm(9.6)],
)

doc.add_heading("4.2 工具命令", level=2)
make_table(
    ["命令", "说明"],
    [
        ["/litematica:logclean status|clean|config", "日志清理：查看状态 / 立即清理 / 查看配置"],
        ["/litematica:config reload|reset|get <key>", "配置管理：重载 / 重置 / 查看某项配置"],
        ["/litematica:web status|start|stop|restart", "网页上传站：状态 / 启动 / 停止 / 重启"],
        ["/litematica:web token|url", "重生成上传令牌 / 查看访问地址"],
    ],
    widths=[Cm(6.2), Cm(9.6)],
)

doc.add_heading("4.3 ghost 运维命令", level=2)
para("ghost 是投影渲染出的半透明方块。出现异常残留时，可用以下命令清理：")
make_table(
    ["命令", "说明"],
    [
        ["/litematica ghost clean", "回收孤儿 ghost（依赖内存会话，跳过活跃会话）"],
        ["/litematica ghost sweep", "以自身为中心 5×5 区块、纵向 ±32 层扫描并把 lit:g_* 写回空气"],
        ["/litematica ghost sweep 3", "改为 3×3 区块范围"],
        ["/litematica ghost sweep 12", "使用旧的格半径"],
        ["/litematica ghost sweep box x1 y1 z1 x2 y2 z2", "精确框选范围"],
        ["/litematica ghost sweep ... dry", "末尾加 dry 只统计、不写入"],
    ],
    widths=[Cm(8.2), Cm(7.6)],
)
callout("什么情况用 sweep？",
        "sweep 按坐标直接读世界、把 lit:g_* 方块写回空气，不依赖内存会话，因此能清理强退残留的 ghost（如服务器崩溃、强制关服后世界里的投影方块）。活跃会话的格会被跳过（kept），不会误删正在使用的投影。")

# =====================================================
# 5. 网页上传站
# =====================================================
doc.add_heading("5. 网页上传站", level=1)
para("服务器启动时，插件会自动拉起一个轻量 HTTP 上传站，供玩家浏览器自助上传 .litematic / .mcstructure 文件。上传后的文件直接落入 plugins/LitematicaBE/schematics/，游戏内立即可用，无需重启。")

doc.add_heading("5.1 使用流程", level=2)
numbered("在 config.json 的 web 节中设置服务器公网 IP 并开放相应端口（默认 8080）；NAT 网络需要部署反向代理；")
numbered("服务端启动后，控制台输出：[Web] 上传站已启动 http://<地址>:8080/；")
numbered("若启用令牌认证：令牌首次自动生成并写入 plugins/LitematicaBE/data/web_token.txt；也可用 /litematica:web token 重新生成（旧地址立即失效）；")
numbered("浏览器打开地址，选择上传 .litematic / .mcstructure 文件，游戏内立刻可用。")

doc.add_heading("5.2 令牌认证", level=2)
para("config.json 中 web.tokenRequired 可开启令牌认证。开启后：")
bullet("访问地址为 http://<地址>:8080/?token=<令牌>；")
bullet("令牌仅 OP 与管理员可见（/litematica:web status 或 token）；")
bullet("localhostNoToken=true 时，本机访问可省略令牌。")
para("上传方式为分片 + base64，单文件上限 web.maxFileMB（默认 64MB），支持断点续传。")

doc.add_heading("5.3 上传站运维", level=2)
add_code("""/litematica web                # 查看上传站状态
/litematica:web start|stop|restart   # 启停上传站（需 OP）
/litematica:web token                # 重新生成令牌（旧地址立即失效）
/litematica:web url                  # 查看访问地址""")

# =====================================================
# 6. 配置文件说明
# =====================================================
doc.add_page_break()
doc.add_heading("6. 配置文件说明", level=1)
para("用户配置文件为 plugins/LitematicaBE/config.json。文件支持 // 注释与尾随逗号（插件内使用宽松解析）。修改后可用 /litematica:config reload 热重载，或重启服务器。")

doc.add_heading("6.1 投影渲染 render", level=2)
make_table(
    ["配置项", "默认值", "说明"],
    [
        ["render.mode", "ghost", "渲染模式（当前仅 ghost）"],
        ["render.ghostWritesPerTick", "300", "每 tick 最多写入数（1 万方块 ≈ 34 tick）"],
        ["render.ghostMaxBlocks", "60000", "单个投影最多写入数（防写爆存档）"],
        ["render.ghostOverwriteReplaceable", "true", "是否覆盖花草/水/雪这类可替换方块"],
        ["render.tickBudgetMs", "8", "统一调度器单 tick 给周期任务的总预算（毫秒）"],
        ["render.enableMega", "true", "超大投影（分块存储 + ghost 分块注入）"],
    ],
    widths=[Cm(5.4), Cm(2.2), Cm(8.2)],
)

doc.add_heading("6.2 轻松放置 easyPlace", level=2)
make_table(
    ["配置项", "默认值", "说明"],
    [
        ["easyPlace.enabled", "true", "启用轻松放置"],
        ["easyPlace.printer.radius", "6", "打印机搜索半径（格）：以玩家为中心的球体"],
        ["easyPlace.printer.maxPerCycle", "12", "每轮（200ms）最多放置数"],
        ["easyPlace.printer.budgetMs", "6", "单轮时间预算（毫秒），溢出顺延"],
        ["easyPlace.printer.placeDelayMs", "0", "放置间隔（毫秒），为 0 时立即放置"],
        ["easyPlace.printer.overwriteReplaceable", "true", "顶掉花草/雪/水；玩家自己放的方块永远不覆盖"],
        ["easyPlace.printer.debug", "false", "true = 写 logs/LitematicaBE/easyplace_debug.log（最多 5 秒一条）"],
    ],
    widths=[Cm(5.4), Cm(2.2), Cm(8.2)],
)

doc.add_heading("6.3 保存投影 schematicSave", level=2)
make_table(
    ["配置项", "默认值", "说明"],
    [
        ["schematicSave.defaultFormat", "litematic", "表单默认项：litematic | mcstructure | both"],
        ["schematicSave.maxVolume", "1000000", ".mcstructure 单次导出格数上限（≈ 100×100×100）"],
        ["schematicSave.includeBlockEntities", "true", "写入箱子/漏斗等方块实体（block_position_data）"],
        ["schematicSave.writeLiquidLayer", "true", "第二层 block_indices 整层 -1 占位（+体积 × 4 B）"],
        ["schematicSave.blockVersion", "18168865", "写进 block_palette[*].version（实测样本值 = 1.21.60.33）"],
        ["schematicSave.formatVersion", "1", "root.format_version"],
        ["schematicSave.verboseScan", "false", "逐格扫描日志（排查用）；默认只打汇总"],
    ],
    widths=[Cm(5.4), Cm(2.2), Cm(8.2)],
)

doc.add_heading("6.4 投影显示 projection", level=2)
make_table(
    ["配置项", "默认值", "说明"],
    [
        ["projection.showBounds", "true", "显示投影边界框"],
        ["projection.boundsColor", "#00FF00", "边界框颜色"],
        ["projection.mirrorX / mirrorZ", "false", "默认镜像 X / Z 轴"],
        ["projection.rotation", "0", "默认旋转角度（0/90/180/270）"],
    ],
    widths=[Cm(5.4), Cm(2.2), Cm(8.2)],
)

doc.add_heading("6.5 Mega 超大型投影", level=2)
make_table(
    ["配置项", "默认值", "说明"],
    [
        ["enableMega", "true", "false 时超阈值会回退普通加载"],
        ["megaSchematic.threshold", "100000", "MEGA 投影方块数阈值（超过则走分块存储 + 流式加载）"],
        ["megaSchematic.enabled", "true", "允许超大型投影加载（仍需 render.enableMega 才能真渲染）"],
        ["megaSchematic.storagePath", "./plugins/LitematicaBE/mega_schematics/", "分块存储路径"],
        ["megaRender.debug", "false", "true = 输出 [MegaRender] 详细调试信息"],
        ["megaRender.fileDebug", "false", "true = 额外写 plugins/LitematicaBE/logs/ 下的注入日志"],
    ],
    widths=[Cm(5.4), Cm(2.2), Cm(8.2)],
)
rich([("说明：", {"bold": True}), ("megaSchematic.chunkSize", {"code": True}), (" 仅为说明项，实际分块大小由 BinaryChunkStorage.CHUNK_SIZE 固定为 32，修改无效。", {})], space_after=6)

doc.add_heading("6.6 HTTP 上传站 web", level=2)
make_table(
    ["配置项", "默认值", "说明"],
    [
        ["web.enabled", "true", "启用上传站"],
        ["web.engine", "node", "node = Node 原生 http（默认）；lse = ll.network 的 HttpServer（兼容保留）"],
        ["web.host", "0.0.0.0", "服务器 IP"],
        ["web.port", "8080", "监听端口"],
        ["web.tokenRequired", "false", "是否开启令牌认证"],
        ["web.localhostNoToken", "true", "本机访问省略令牌认证"],
        ["web.token", "INPUT-YOUR_TOKEN_HERE", "手动指定令牌（留空则自动生成）"],
        ["web.allowIps", "[]", "前缀匹配，如 [\"192.168.\", \"10.0.\"]；空 = 不限制"],
        ["web.maxFileMB", "64", "单文件上限（MB）"],
        ["web.chunkKB", "512", "分片大小（二进制 base64 分片传）"],
        ["web.allowExt", "[.litematic, .mcstructure]", "允许上传的扩展名"],
        ["web.overwrite", "false", "false = 同名文件自动加 -1/-2，防顶投影"],
        ["web.maxUploadsPerMinute", "10", "单 IP 每分钟最多上传次数"],
        ["web.targetDir", "./plugins/LitematicaBE/schematics/", "上传目标目录"],
        ["web.publicUrl", "", "反代时填对外地址，仅用于日志和页面展示"],
    ],
    widths=[Cm(5.4), Cm(2.2), Cm(8.2)],
)

doc.add_heading("6.7 更新检查 updateCheck", level=2)
make_table(
    ["配置项", "默认值", "说明"],
    [
        ["updateCheck.enabled", "true", "false = 彻底关闭联网检查"],
        ["updateCheck.repo", "copper-lamp/LitematicaBE", "GitHub 仓库"],
        ["updateCheck.mirror", "", "镜像站（可选），支持 {repo} 占位"],
        ["updateCheck.timeoutMs", "8000", "单次请求超时（1000-30000）"],
    ],
    widths=[Cm(5.4), Cm(2.2), Cm(8.2)],
)
rich([("说明：", {"bold": True}), ("更新检查只在服务端启动、插件激活时联网查询一次，不传输任何用户数据，仅获取最新版本号和下载地址。", {})], space_after=6)

doc.add_heading("6.8 日志与杂项", level=2)
make_table(
    ["配置项", "默认值", "说明"],
    [
        ["logCleaner.enabled", "true", "启用自动清理渲染日志"],
        ["logCleaner.scanInterval", "60000", "扫描间隔（毫秒）"],
        ["logCleaner.backupEnabled", "true", "清理前备份"],
        ["logCleaner.maxBackupFiles", "10", "最多保留备份数"],
        ["misc.showLayerInfo", "false", "分层切换成功时是否显示当前层/方块数提示"],
        ["misc.verboseCommandLog", "false", "命令注册成功日志（排查命令没注册上时改 true）"],
        ["misc.verboseStartupLog", "false", "启动期信息日志总开关"],
    ],
    widths=[Cm(5.4), Cm(2.2), Cm(8.2)],
)

# =====================================================
# 7. 常见问题
# =====================================================
doc.add_page_break()
doc.add_heading("7. 常见问题（FAQ）", level=1)

qa = [
    ("Q：为什么我发现部分功能存在问题？",
     "A：第三代 LitematicaBE 正在重构更新中，部分功能尚未经过大范围严格测试。若发现问题，请向开发者反馈处理。"),
    ("Q：投影显示为未知或错误材质？",
     "A：多为方块映射问题。Java 版与基岩版方块差异较大，遇到这种情况请提交 Issue，并附上方块名与截图。"),
    ("Q：ghost 写入被禁用 / 提示版本不一致？",
     "A：插件与服务端 addon（BP/RP）必须为同批版本。重新执行 /litematica selfcheck 查看具体项，并确认世界已启用对应扩展包。"),
    ("Q：大型投影加载卡顿？",
     "A：受限于基岩版，帧率取决于玩家客户端渲染能力，服务端插件无法直接解决该问题。数十万级超大投影建议先拆分或用逐层显示。"),
    ("Q：保存的原理图能在 Java 版打开吗？",
     "A：以 .litematic 格式导出能兼容 Java 版 Litematica 并直接使用。"),
    ("Q：为什么 /lit printer 提示重载不匹配？",
     "A：旧版短命令只声明了空重载，导致子命令入口不可达。请升级到最新版本——现在 /lit 与 /litematica 行为完全一致。"),
]
for q, a in qa:
    p = doc.add_paragraph()
    r = p.add_run(q)
    r.font.bold = True
    r.font.size = Pt(10.5)
    r.font.name = ASCII_FONT
    set_east(r)
    r.font.color.rgb = PRIMARY
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(2)
    p2 = doc.add_paragraph()
    r2 = p2.add_run(a)
    r2.font.size = Pt(10.5)
    r2.font.name = ASCII_FONT
    set_east(r2)
    p2.paragraph_format.space_after = Pt(6)

# =====================================================
# 8. 帮助与反馈
# =====================================================
doc.add_heading("8. 帮助与反馈", level=1)
para("欢迎提交 Issue 与 Pull Request，也欢迎加入开发者交流群反馈问题与建议：")
make_table(
    ["渠道", "地址"],
    [
        ["GitHub 仓库", "https://github.com/copper-lamp/LitematicaBE"],
        ["反馈问题", "https://github.com/copper-lamp/LitematicaBE/issues"],
        ["QQ 交流群", "861900673"],
    ],
    widths=[Cm(4.4), Cm(11.4)],
)

para("", space_after=4)
para("本插件使用 AGPL-3.0 许可证。使用修改版本并分发或用于提供服务时，必须继续使用 AGPL-3.0，并公开源代码。", size=9.5, color=GRAY)

doc.save("LitematicaBE-用户使用文档.docx")
print("OK saved LitematicaBE-用户使用文档.docx")
