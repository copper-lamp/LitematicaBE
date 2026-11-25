#include "LitematicaBE/web/UploadServer.h"

#include "LitematicaBE/web/UploadPage.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"

#include <nlohmann/json.hpp>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <random>
#include <sstream>
#include <string>
#include <system_error>

#pragma comment(lib, "ws2_32.lib")

namespace litematicabe::web {

namespace {

using json = nlohmann::json;

constexpr std::size_t kMaxHeaderBytes = 16 * 1024;
constexpr std::size_t kMaxBodyBytes   = 64ull * 1024 * 1024;

std::string toLower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

std::string trim(std::string s) {
    while (!s.empty() && (s.back() == '\r' || s.back() == '\n' || s.back() == ' ' || s.back() == '\t')) {
        s.pop_back();
    }
    std::size_t start = 0;
    while (start < s.size() && (s[start] == ' ' || s[start] == '\t')) {
        ++start;
    }
    return s.substr(start);
}

std::string randomToken() {
    static char const* hex = "0123456789abcdef";
    std::random_device  rd;
    std::string         out;
    out.reserve(32);
    for (int i = 0; i < 32; ++i) {
        out.push_back(hex[rd() & 0xF]);
    }
    return out;
}

std::string urlDecode(std::string const& in) {
    std::string out;
    out.reserve(in.size());
    for (std::size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%' && i + 2 < in.size()) {
            auto const hex = in.substr(i + 1, 2);
            try {
                out.push_back(static_cast<char>(std::stoi(hex, nullptr, 16)));
                i += 2;
                continue;
            } catch (...) {
                // 落到下面的原样追加
            }
        }
        out.push_back(in[i] == '+' ? ' ' : in[i]);
    }
    return out;
}

// 从 `/upload?token=xxx` 里取 token。
std::string queryValue(std::string const& target, std::string const& key) {
    auto const qmark = target.find('?');
    if (qmark == std::string::npos) {
        return {};
    }
    auto const  query = target.substr(qmark + 1);
    std::size_t pos   = 0;
    while (pos < query.size()) {
        auto const amp = query.find('&', pos);
        auto const pair = query.substr(pos, amp == std::string::npos ? std::string::npos : amp - pos);
        auto const eq   = pair.find('=');
        if (eq != std::string::npos && pair.substr(0, eq) == key) {
            return urlDecode(pair.substr(eq + 1));
        }
        if (amp == std::string::npos) {
            break;
        }
        pos = amp + 1;
    }
    return {};
}

struct Request {
    std::string method;
    std::string target;
    std::string contentType;
    std::size_t contentLength{};
    std::string body;
    bool        headersOk{};
};

bool recvUntil(std::string& buffer, std::size_t& scanned, SOCKET client, std::string_view needle, std::size_t limit) {
    char chunk[4096];
    while (true) {
        // 在「已知未匹配」起点之后查找分隔符；初始 scanned = 0。
        if (buffer.find(needle, scanned) != std::string::npos) {
            return true;
        }
        if (buffer.size() > limit) {
            return false;
        }
        auto const oldSize = buffer.size();
        int const received = ::recv(client, chunk, static_cast<int>(sizeof(chunk)), 0);
        if (received <= 0) {
            return false;
        }
        buffer.append(chunk, static_cast<std::size_t>(received));
        if (buffer.size() > limit) {
            return false;
        }
        scanned = oldSize > needle.size() ? oldSize - (needle.size() - 1) : 0;
    }
}

bool recvExact(std::string& buffer, SOCKET client, std::size_t total) {
    char chunk[8192];
    while (buffer.size() < total) {
        auto const want = static_cast<int>(std::min<std::size_t>(sizeof(chunk), total - buffer.size()));
        int const  got  = ::recv(client, chunk, want, 0);
        if (got <= 0) {
            return false;
        }
        buffer.append(chunk, static_cast<std::size_t>(got));
    }
    return true;
}

bool parseRequest(SOCKET client, Request& request) {
    std::string buffer;
    std::size_t scanned = 0;
    if (!recvUntil(buffer, scanned, client, "\r\n\r\n", kMaxHeaderBytes)) {
        return false;
    }

    auto const headerEnd = buffer.find("\r\n\r\n");
    auto const header    = buffer.substr(0, headerEnd);

    std::istringstream stream{header};
    std::string        line;
    if (!std::getline(stream, line)) {
        return false;
    }
    {
        std::istringstream first{line};
        std::string        version;
        first >> request.method >> request.target >> version;
        if (request.method.empty() || request.target.empty()) {
            return false;
        }
    }

    while (std::getline(stream, line)) {
        auto const colon = line.find(':');
        if (colon == std::string::npos) {
            continue;
        }
        auto const key   = toLower(trim(line.substr(0, colon)));
        auto const value = trim(line.substr(colon + 1));
        if (key == "content-type") {
            request.contentType = value;
        } else if (key == "content-length") {
            try {
                request.contentLength = static_cast<std::size_t>(std::stoull(value));
            } catch (...) {
                return false;
            }
        }
    }

    request.headersOk = true;
    if (request.contentLength == 0) {
        return true;
    }
    if (request.contentLength > kMaxBodyBytes) {
        return false;
    }

    std::string body = buffer.substr(headerEnd + 4);
    if (!recvExact(body, client, request.contentLength)) {
        return false;
    }
    body.resize(request.contentLength);
    request.body = std::move(body);
    return true;
}

void respond(SOCKET client, int status, char const* contentType, std::string const& body) {
    char const* reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 401 ? "Unauthorized"
                       : status == 404 ? "Not Found" : "Internal Server Error";

    std::string head;
    head.reserve(160);
    head += "HTTP/1.1 " + std::to_string(status) + " " + reason + "\r\n";
    head += std::string{"Content-Type: "} + contentType + "\r\n";
    head += "Content-Length: " + std::to_string(body.size()) + "\r\n";
    head += "Cache-Control: no-store\r\n";
    head += "Connection: close\r\n\r\n";
    head += body;

    std::size_t sent = 0;
    while (sent < head.size()) {
        auto const n = ::send(client, head.data() + sent, static_cast<int>(head.size() - sent), 0);
        if (n <= 0) {
            return;
        }
        sent += static_cast<std::size_t>(n);
    }
}

void respondJson(SOCKET client, int status, json const& payload) {
    respond(client, status, "application/json; charset=utf-8", payload.dump());
}

// 从 multipart/form-data 里取出 (filename, 文件内容)。
bool extractMultipart(
    std::string const& body,
    std::string const& contentType,
    std::string&       filename,
    std::string&       data
) {
    auto const boundaryPos = contentType.find("boundary=");
    if (boundaryPos == std::string::npos) {
        return false;
    }
    auto boundary = trim(contentType.substr(boundaryPos + 9));
    if (auto const semi = boundary.find(';'); semi != std::string::npos) {
        boundary = trim(boundary.substr(0, semi));
    }
    if (!boundary.empty() && boundary.front() == '"') {
        boundary.erase(boundary.begin());
        if (!boundary.empty() && boundary.back() == '"') {
            boundary.pop_back();
        }
    }
    if (boundary.empty()) {
        return false;
    }

    auto const delimiter   = "--" + boundary;
    auto const partStart   = body.find(delimiter);
    if (partStart == std::string::npos) {
        return false;
    }
    auto const headerStart = partStart + delimiter.size();
    auto const headerEnd   = body.find("\r\n\r\n", headerStart);
    if (headerEnd == std::string::npos) {
        return false;
    }

    // 两种客户端两种写法：curl/浏览器是 filename="x.litematic"，.NET 的 HttpClient 是 filename=x.litematic（可能还带 filename*=utf-8''x.litematic），都要能认。
    auto const headers = body.substr(headerStart, headerEnd - headerStart);
    auto       nameStart = std::string::npos;
    bool       quoted    = false;
    if (auto const q = headers.find("filename=\""); q != std::string::npos) {
        nameStart = q + 10;
        quoted    = true;
    } else if (auto const p = headers.find("filename="); p != std::string::npos) {
        nameStart = p + 9;
    }
    if (nameStart == std::string::npos) {
        return false;
    }

    auto nameEnd = std::string::npos;
    if (quoted) {
        nameEnd = headers.find('"', nameStart);
    } else {
        nameEnd = headers.find_first_of(";\r\n", nameStart);
    }
    if (nameEnd == std::string::npos) {
        nameEnd = headers.size();
    }
    filename = trim(headers.substr(nameStart, nameEnd - nameStart));

    auto const dataStart = headerEnd + 4;
    auto const dataEnd   = body.find("\r\n" + delimiter, dataStart);
    if (dataEnd == std::string::npos) {
        return false;
    }

    data = body.substr(dataStart, dataEnd - dataStart);
    return !filename.empty();
}

// 只保留文件名本身，去掉路径与非法字符；扩展名必须是投影格式。
bool sanitizeName(std::string name, std::string& out) {
    auto const slash = name.find_last_of("/\\");
    if (slash != std::string::npos) {
        name = name.substr(slash + 1);
    }
    for (char& c : name) {
        auto const uc = static_cast<unsigned char>(c);
        if (uc < 0x20 || c == '<' || c == '>' || c == ':' || c == '"' || c == '|' || c == '?' || c == '*') {
            c = '_';
        }
    }
    if (name.empty() || name == "." || name == "..") {
        return false;
    }

    auto const dot = name.find_last_of('.');
    if (dot == std::string::npos) {
        return false;
    }
    auto const ext = toLower(name.substr(dot));
    if (ext != ".litematic" && ext != ".mcstructure") {
        return false;
    }
    out = name;
    return true;
}

std::filesystem::path utf8Path(std::string const& name) { return ::litematicabe::util::fromUtf8(name); }

// 只用于诊断：把前 n 个字节变成可打印预览。
std::string preview(std::string const& data, std::size_t n) {
    std::string out;
    out.reserve(n + 8);
    for (std::size_t i = 0; i < std::min(n, data.size()); ++i) {
        auto const c = static_cast<unsigned char>(data[i]);
        if (c == '\r') {
            out += "\\r";
        } else if (c == '\n') {
            out += "\\n";
        } else if (c >= 0x20 && c < 0x7F) {
            out.push_back(static_cast<char>(c));
        } else {
            out.push_back('.');
        }
    }
    return out;
}

} // namespace

UploadServer::~UploadServer() {
    stop();
}

UploadServer& UploadServer::getInstance() {
    static UploadServer instance;
    return instance;
}

UploadServer::Stats UploadServer::stats() const {
    Stats s;
    s.accepted = mAccepted.load();
    s.rejected = mRejected.load();
    s.bytes    = mBytes.load();
    return s;
}

std::string UploadServer::schematicsDir() const {
    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        return "schematics";
    }
    return ::litematicabe::util::toUtf8(nativeMod->getModDir() / "schematics");
}

bool UploadServer::start() {
    if (mRunning.load()) {
        return true;
    }

    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        mLastError = "拿不到模组目录";
        return false;
    }

    auto const configDir  = nativeMod->getConfigDir();
    auto const configPath = configDir / "upload.json";

    std::error_code ec;
    std::filesystem::create_directories(configDir, ec);

    json config;
    if (std::filesystem::exists(configPath, ec)) {
        try {
            std::ifstream in{configPath};
            in >> config;
        } catch (std::exception const& e) {
            mLastError = std::string{"upload.json 解析失败："} + e.what();
            return false;
        }
    } else {
        config = json{
            {"enabled",  true},
            {"bind",     "127.0.0.1"},
            {"port",     8686},
            {"token",    ""},
            {"maxSizeMb", 64}
        };
    }

    mBind     = config.value("bind", std::string{"127.0.0.1"});
    mPort     = static_cast<std::uint16_t>(config.value("port", 8686));
    mToken    = config.value("token", std::string{});
    auto const maxMb = config.value("maxSizeMb", 64);
    mMaxBytes = std::clamp<std::size_t>(static_cast<std::size_t>(maxMb), 1, 512) * 1024 * 1024;

    if (mToken.empty()) {
        mToken          = randomToken();
        config["token"] = mToken;
    }
    // 回写：让用户能直接打开文件复制 token（也把默认值固化下来）。
    {
        std::ofstream out{configPath};
        out << config.dump(4) << '\n';
    }

    if (!config.value("enabled", true)) {
        mLastError = "配置里 enabled=false";
        return false;
    }

    WSADATA wsa{};
    if (::WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        mLastError = "WSAStartup 失败";
        return false;
    }

    SOCKET listener = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET) {
        ::WSACleanup();
        mLastError = "创建监听 socket 失败";
        return false;
    }

    int reuse = 1;
    ::setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<char const*>(&reuse), sizeof(reuse));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port   = htons(mPort);
    if (::InetPtonA(AF_INET, mBind.c_str(), &addr.sin_addr) != 1) {
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        mBind                = "127.0.0.1";
    }

    if (::bind(listener, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
        ::closesocket(listener);
        ::WSACleanup();
        mLastError = "bind 失败（检查端口是否被占用）：" + mBind + ":" + std::to_string(mPort);
        return false;
    }
    if (::listen(listener, 8) == SOCKET_ERROR) {
        ::closesocket(listener);
        ::WSACleanup();
        mLastError = "listen 失败";
        return false;
    }

    mListen  = static_cast<std::uintptr_t>(listener);
    mStop    = false;
    mUrl     = "http://" + mBind + ":" + std::to_string(mPort) + "/";
    mRunning = true;
    mThread  = std::thread([this] { serve(); });

    mLastError.clear();
    return true;
}

void UploadServer::stop() {
    if (!mRunning.exchange(false)) {
        return;
    }
    mStop = true;
    if (mListen != static_cast<std::uintptr_t>(~0ull)) {
        ::closesocket(static_cast<SOCKET>(mListen));
        mListen = static_cast<std::uintptr_t>(~0ull);
    }
    if (mThread.joinable()) {
        mThread.join();
    }
    ::WSACleanup();
}

void UploadServer::serve() {
    while (!mStop.load()) {
        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(static_cast<SOCKET>(mListen), &readSet);

        timeval timeout{};
        timeout.tv_sec  = 0;
        timeout.tv_usec = 200 * 1000;

        auto const ready = ::select(0, &readSet, nullptr, nullptr, &timeout);
        if (ready <= 0) {
            continue;
        }

        SOCKET client = ::accept(static_cast<SOCKET>(mListen), nullptr, nullptr);
        if (client == INVALID_SOCKET) {
            continue;
        }
        handleClient(static_cast<std::uintptr_t>(client));
        ::closesocket(client);
    }
}

void UploadServer::handleClient(std::uintptr_t clientPtr) {
    auto const client = static_cast<SOCKET>(clientPtr);

    // 防御：任何连接（含浏览器预连接、中断的半途上传）都不允许无限期占住服务器线程。设置接收超时后，recv 超时返回错误，走 bad request 收尾，serve() 循环能继续 accept 下一个连接，避免一个坏连接卡死全部上传。
    {
        DWORD const rcvTimeoutMs = 30 * 1000;
        ::setsockopt(
            client,
            SOL_SOCKET,
            SO_RCVTIMEO,
            reinterpret_cast<char const*>(&rcvTimeoutMs),
            sizeof(rcvTimeoutMs)
        );
    }

    auto logger = []() -> ::ll::io::Logger* {
        auto nativeMod = ::ll::mod::NativeMod::current();
        return nativeMod ? &nativeMod->getLogger() : nullptr;
    }();

    Request request;
    if (!parseRequest(client, request)) {
        ++mRejected;
        respondJson(client, 400, {{"ok", false}, {"error", "bad request"}});
        return;
    }

    // GET / ：上传页
    if (request.method == "GET" && (request.target == "/" || request.target.rfind("/?", 0) == 0)) {
        respond(client, 200, "text/html; charset=utf-8", kUploadPage);
        return;
    }

    // GET /files ：列出已有投影（只读，方便页面确认）
    if (request.method == "GET" && request.target.rfind("/files", 0) == 0) {
        std::error_code ec;
        json            list = json::array();
        std::filesystem::directory_iterator it{std::filesystem::path{schematicsDir()}, ec};
        if (!ec) {
            for (auto const& entry : it) {
                if (!entry.is_regular_file(ec)) {
                    continue;
                }
                auto const ext = toLower(::litematicabe::util::toUtf8(entry.path().extension()));
                if (ext != ".litematic" && ext != ".mcstructure") {
                    continue;
                }
                list.push_back(
                    {{"name", ::litematicabe::util::toUtf8(entry.path().filename())},
                     {"size", entry.file_size(ec)}}
                );
            }
        }
        respondJson(client, 200, {{"ok", true}, {"files", list}});
        return;
    }

    if (request.method != "POST" || request.target.rfind("/upload", 0) != 0) {
        ++mRejected;
        respondJson(client, 404, {{"ok", false}, {"error", "not found"}});
        return;
    }

    // token 鉴权
    auto const token = queryValue(request.target, "token");
    if (token.empty() || token != mToken) {
        ++mRejected;
        if (logger) {
            logger->warn("上传被拒绝：token 不匹配（来自 {} 的请求）", request.target.substr(0, 32));
        }
        respondJson(client, 401, {{"ok", false}, {"error", "bad token"}});
        return;
    }

    if (request.body.empty()) {
        ++mRejected;
        respondJson(client, 400, {{"ok", false}, {"error", "empty body"}});
        return;
    }
    if (request.body.size() > mMaxBytes) {
        ++mRejected;
        respondJson(client, 400, {{"ok", false}, {"error", "file too large"}});
        return;
    }

    std::string filename;
    std::string data;
    if (!extractMultipart(request.body, request.contentType, filename, data)) {
        ++mRejected;
        if (logger) {
            logger->warn(
                "上传失败：multipart 解析不出文件（ct={}，body={} 字节，前 120：{}）",
                request.contentType,
                request.body.size(),
                preview(request.body, 120)
            );
        }
        respondJson(client, 400, {{"ok", false}, {"error", "expect multipart/form-data with a file field"}});
        return;
    }

    std::string safe;
    if (!sanitizeName(filename, safe)) {
        ++mRejected;
        if (logger) {
            logger->warn("上传失败：文件名不合法或扩展名不对（{}）", filename);
        }
        respondJson(client, 400, {{"ok", false}, {"error", "only .litematic / .mcstructure are accepted"}});
        return;
    }

    std::error_code ec;
    auto const      dir = std::filesystem::path{schematicsDir()};
    std::filesystem::create_directories(dir, ec);

    auto const target = dir / utf8Path(safe);
    {
        std::ofstream out{target, std::ios::binary | std::ios::trunc};
        if (!out) {
            ++mRejected;
            respondJson(client, 500, {{"ok", false}, {"error", "cannot write file"}});
            return;
        }
        out.write(data.data(), static_cast<std::streamsize>(data.size()));
    }

    ++mAccepted;
    mBytes += data.size();

    if (logger) {
        logger->info("已接收投影上传：{}（{} 字节）", safe, data.size());
    }
    respondJson(
        client,
        200,
        {{"ok", true}, {"file", safe}, {"size", data.size()}, {"hint", "/lit load " + safe}}
    );
}

} // namespace litematicabe::web
