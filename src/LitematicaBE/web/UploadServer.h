#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>

namespace litematicabe::web {

// 内置的投影上传服务。

class UploadServer {
public:
    static UploadServer& getInstance();

    // 读配置并启动；返回 false 表示未启用或启动失败（原因写在 lastError）。
    bool start();

    // 停止监听并回收线程。
    void stop();

    [[nodiscard]] bool running() const noexcept { return mRunning.load(); }

    [[nodiscard]] std::string const& url() const noexcept { return mUrl; }
    [[nodiscard]] std::string const& token() const noexcept { return mToken; }
    [[nodiscard]] std::string const& lastError() const noexcept { return mLastError; }

    struct Stats {
        std::uint64_t accepted{};
        std::uint64_t rejected{};
        std::uint64_t bytes{};
    };

    [[nodiscard]] Stats stats() const;

private:
    UploadServer() = default;
    ~UploadServer();

    void        serve();
    void        handleClient(std::uintptr_t client);
    std::string schematicsDir() const;

    std::atomic<bool> mRunning{false};
    std::atomic<bool> mStop{false};

    std::uintptr_t mListen{static_cast<std::uintptr_t>(~0ull)};
    std::thread    mThread;
    std::string    mUrl;
    std::string    mToken;
    std::string    mBind;
    std::uint16_t  mPort{};
    std::size_t    mMaxBytes{};

    mutable std::mutex mMutex;
    std::string        mLastError;

    std::atomic<std::uint64_t> mAccepted{0};
    std::atomic<std::uint64_t> mRejected{0};
    std::atomic<std::uint64_t> mBytes{0};
};

} // namespace litematicabe::web
