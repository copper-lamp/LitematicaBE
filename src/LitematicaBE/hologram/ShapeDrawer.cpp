#include "LitematicaBE/hologram/ShapeDrawer.h"

#include <windows.h>

#if defined(LITEMATICABE_WITH_HOLOGRAMLIB) && LITEMATICABE_WITH_HOLOGRAMLIB
#include <hologramlib/HologramLib.h>
#endif

namespace litematicabe::hologram {

namespace {

constexpr wchar_t kHologramLibModule[] = L"HologramLib.dll";

// x64 的 MSVC 名字修饰（clang-cl 使用同一套 MS ABI）。
constexpr char kGetInstance[] = "?getInstance@IHologramLib@hologramlib@@SAAEAV12@XZ";

// ABI 戳是导出的 C 函数（`uint32_t __cdecl hologramlib_abiStamp()`），
// 不是变量——按变量解引用会读到函数机器码，永远判成 mismatch。
constexpr char kAbiStamp[] = "hologramlib_abiStamp";

} // namespace

ShapeDrawer& ShapeDrawer::getInstance() {
    static ShapeDrawer instance;
    return instance;
}

void ShapeDrawer::resolve() {
    mProbed = true;

#if defined(LITEMATICABE_WITH_HOLOGRAMLIB) && LITEMATICABE_WITH_HOLOGRAMLIB
    // 前置是独立插件：插件没被加载时，先按进程内存查找，再尝试加载。
    HMODULE module = ::GetModuleHandleW(kHologramLibModule);
    if (module == nullptr) {
        module = ::LoadLibraryW(kHologramLibModule);
    }
    if (module == nullptr) {
        mReason = "HologramLib.dll not loaded";
        return;
    }

    auto const stampFn = reinterpret_cast<std::uint32_t (*)()>(::GetProcAddress(module, kAbiStamp));
    if (stampFn == nullptr || stampFn() != HOLOGLIB_ABI_STAMP) {
        mReason = "HologramLib ABI stamp mismatch";
        return;
    }

    auto getInstance = reinterpret_cast<hologramlib::IHologramLib& (*)()>(
        ::GetProcAddress(module, kGetInstance)
    );
    if (getInstance == nullptr) {
        mReason = "getInstance export missing";
        return;
    }

    hologramlib::IHologramLib& lib = getInstance();
    if (lib.version() < HOLOGLIB_API_VERSION) {
        mReason = "HologramLib older than headers";
        return;
    }

    // shapeExt() 是 1.36.0 起的尾部域（setMaxRenderDistance 在这里）；
    // 上面的 version 检查已经保证它存在。
    mShapes    = static_cast<void*>(&lib.shapes());
    mShapeExt  = static_cast<void*>(&lib.shapeExt());
    mAvailable = true;
    mReason    = "ok";
#else
    mReason = "compiled without HologramLib headers";
#endif
}

bool ShapeDrawer::available() {
    if (!mProbed) {
        resolve();
    }
    return mAvailable;
}

#if defined(LITEMATICABE_WITH_HOLOGRAMLIB) && LITEMATICABE_WITH_HOLOGRAMLIB

#define LITEMATICABE_SHAPES static_cast<hologramlib::IShapeDrawer*>(mShapes)

std::int64_t ShapeDrawer::createBox(float x1, float y1, float z1, float x2, float y2, float z2) {
    if (!available()) {
        return 0;
    }
    return LITEMATICABE_SHAPES->createBox(x1, y1, z1, x2, y2, z2);
}

std::int64_t ShapeDrawer::createLine(float x1, float y1, float z1, float x2, float y2, float z2) {
    if (!available()) {
        return 0;
    }
    return LITEMATICABE_SHAPES->createLine(x1, y1, z1, x2, y2, z2);
}

bool ShapeDrawer::setColor(std::int64_t id, float r, float g, float b, float a) {
    return available() && LITEMATICABE_SHAPES->setColor(id, r, g, b, a);
}

bool ShapeDrawer::setMaxRenderDistance(std::int64_t id, float distance) {
    if (!available() || mShapeExt == nullptr) {
        return false;
    }
    return static_cast<hologramlib::IShapeDrawerExt*>(mShapeExt)->setMaxRenderDistance(id, distance);
}

bool ShapeDrawer::setLocation(std::int64_t id, float x, float y, float z) {
    return available() && LITEMATICABE_SHAPES->setLocation(id, x, y, z);
}

bool ShapeDrawer::draw(std::int64_t id) {
    return available() && LITEMATICABE_SHAPES->draw(id);
}

bool ShapeDrawer::update(std::int64_t id) {
    return available() && LITEMATICABE_SHAPES->update(id);
}

bool ShapeDrawer::remove(std::int64_t id) {
    return available() && LITEMATICABE_SHAPES->remove(id);
}

bool ShapeDrawer::destroy(std::int64_t id) {
    return available() && LITEMATICABE_SHAPES->destroy(id);
}

bool ShapeDrawer::exists(std::int64_t id) {
    return available() && LITEMATICABE_SHAPES->exists(id);
}

#undef LITEMATICABE_SHAPES

#else

std::int64_t ShapeDrawer::createBox(float, float, float, float, float, float) {
    return 0;
}

std::int64_t ShapeDrawer::createLine(float, float, float, float, float, float) {
    return 0;
}

bool ShapeDrawer::setColor(std::int64_t, float, float, float, float) {
    return false;
}

bool ShapeDrawer::setMaxRenderDistance(std::int64_t, float) {
    return false;
}

bool ShapeDrawer::setLocation(std::int64_t, float, float, float) {
    return false;
}

bool ShapeDrawer::draw(std::int64_t) {
    return false;
}

bool ShapeDrawer::update(std::int64_t) {
    return false;
}

bool ShapeDrawer::remove(std::int64_t) {
    return false;
}

bool ShapeDrawer::destroy(std::int64_t) {
    return false;
}

bool ShapeDrawer::exists(std::int64_t) {
    return false;
}

#endif

} // namespace litematicabe::hologram
