#include "LitematicaBE/core/nbt/NbtTag.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include <miniz/miniz.h>

#include <cstring>
#include <fstream>
#include <system_error>
#include <utility>

namespace litematicabe::core::nbt {

namespace {

class Reader {
public:
    Reader(std::uint8_t const* data, std::size_t size, Endian endian)
    : mData(data),
      mSize(size),
      mBigEndian(endian == Endian::Big) {}

    [[nodiscard]] bool ok() const noexcept { return mOk; }
    [[nodiscard]] std::size_t remaining() const noexcept { return mSize - mPos; }

    bool skip(std::size_t n) {
        if (!ensure(n)) {
            return false;
        }
        mPos += n;
        return true;
    }

    std::uint8_t u8() {
        if (!ensure(1)) {
            return 0;
        }
        return mData[mPos++];
    }

    std::uint16_t u16() {
        if (!ensure(2)) {
            return 0;
        }
        auto const b0 = static_cast<std::uint16_t>(mData[mPos]);
        auto const b1 = static_cast<std::uint16_t>(mData[mPos + 1]);
        mPos += 2;
        return mBigEndian ? static_cast<std::uint16_t>((b0 << 8) | b1) : static_cast<std::uint16_t>((b1 << 8) | b0);
    }

    std::uint32_t u32() {
        if (!ensure(4)) {
            return 0;
        }
        std::uint32_t value = 0;
        if (mBigEndian) {
            for (int i = 0; i < 4; ++i) {
                value = (value << 8) | mData[mPos + i];
            }
        } else {
            for (int i = 3; i >= 0; --i) {
                value = (value << 8) | mData[mPos + i];
            }
        }
        mPos += 4;
        return value;
    }

    std::uint64_t u64() {
        if (!ensure(8)) {
            return 0;
        }
        std::uint64_t value = 0;
        if (mBigEndian) {
            for (int i = 0; i < 8; ++i) {
                value = (value << 8) | mData[mPos + i];
            }
        } else {
            for (int i = 7; i >= 0; --i) {
                value = (value << 8) | mData[mPos + i];
            }
        }
        mPos += 8;
        return value;
    }

    std::string str() {
        auto const len = u16();
        if (!ensure(len)) {
            return {};
        }
        std::string s(reinterpret_cast<char const*>(mData + mPos), len);
        mPos += len;
        return s;
    }

    std::uint8_t const* raw(std::size_t n) {
        if (!ensure(n)) {
            return nullptr;
        }
        auto const* p = mData + mPos;
        mPos += n;
        return p;
    }

    void fail() { mOk = false; }

private:
    bool ensure(std::size_t n) {
        if (!mOk || mPos + n > mSize || mPos + n < mPos) {
            mOk = false;
            return false;
        }
        return true;
    }

    std::uint8_t const* mData{};
    std::size_t         mSize{};
    std::size_t         mPos{};
    bool                mBigEndian{true};
    bool                mOk{true};
};

TagPtr readPayload(Reader& reader, TagType type, int depth);

TagPtr readCompound(Reader& reader, int depth) {
    auto tag   = std::make_shared<Tag>();
    tag->type = TagType::Compound;

    for (;;) {
        if (!reader.ok()) {
            return nullptr;
        }
        auto const childType = static_cast<TagType>(reader.u8());
        if (childType == TagType::End) {
            break;
        }
        auto const name  = reader.str();
        auto       child = readPayload(reader, childType, depth + 1);
        if (child == nullptr) {
            return nullptr;
        }
        tag->compound.emplace(name, std::move(child));
    }
    return tag;
}

TagPtr readList(Reader& reader, int depth) {
    auto tag   = std::make_shared<Tag>();
    tag->type = TagType::List;

    auto const childType = static_cast<TagType>(reader.u8());
    auto const count     = reader.u32();
    tag->listType        = childType;
    if (!reader.ok()) {
        return nullptr;
    }
    // 防御：单个列表最多 1<<24 项，避免损坏文件把内存打爆。
    if (count > (1u << 24)) {
        reader.fail();
        return nullptr;
    }
    tag->list.reserve(count);
    for (std::uint32_t i = 0; i < count; ++i) {
        auto child = readPayload(reader, childType, depth + 1);
        if (child == nullptr) {
            return nullptr;
        }
        tag->list.push_back(std::move(child));
    }
    return tag;
}

TagPtr readPayload(Reader& reader, TagType type, int depth) {
    if (depth > 64) {
        reader.fail();
        return nullptr;
    }

    auto tag   = std::make_shared<Tag>();
    tag->type = type;

    switch (type) {
    case TagType::Byte:
        tag->intValue = static_cast<std::int8_t>(reader.u8());
        break;
    case TagType::Short:
        tag->intValue = static_cast<std::int16_t>(reader.u16());
        break;
    case TagType::Int:
        tag->intValue = static_cast<std::int32_t>(reader.u32());
        break;
    case TagType::Long:
        tag->intValue = static_cast<std::int64_t>(reader.u64());
        break;
    case TagType::Float: {
        auto const bits = reader.u32();
        float      value;
        static_assert(sizeof(value) == sizeof(bits));
        std::memcpy(&value, &bits, sizeof(value));
        tag->doubleValue = value;
        break;
    }
    case TagType::Double: {
        auto const bits = reader.u64();
        double     value;
        static_assert(sizeof(value) == sizeof(bits));
        std::memcpy(&value, &bits, sizeof(value));
        tag->doubleValue = value;
        break;
    }
    case TagType::ByteArray: {
        auto const count = reader.u32();
        if (count > (1u << 28)) {
            reader.fail();
            return nullptr;
        }
        auto const* p = reader.raw(count);
        if (p == nullptr) {
            return nullptr;
        }
        tag->byteArray.assign(p, p + count);
        break;
    }
    case TagType::String:
        tag->stringValue = reader.str();
        break;
    case TagType::List:
        return readList(reader, depth);
    case TagType::Compound:
        return readCompound(reader, depth);
    case TagType::IntArray: {
        auto const count = reader.u32();
        if (count > (1u << 26)) {
            reader.fail();
            return nullptr;
        }
        tag->longArray.reserve(count);
        for (std::uint32_t i = 0; i < count; ++i) {
            tag->longArray.push_back(reader.u32());
        }
        break;
    }
    case TagType::LongArray: {
        auto const count = reader.u32();
        if (count > (1u << 26)) {
            reader.fail();
            return nullptr;
        }
        tag->longArray.reserve(count);
        for (std::uint32_t i = 0; i < count; ++i) {
            tag->longArray.push_back(reader.u64());
        }
        break;
    }
    case TagType::End:
    default:
        reader.fail();
        return nullptr;
    }

    if (!reader.ok()) {
        return nullptr;
    }
    return tag;
}

bool looksLikeGzip(std::uint8_t const* data, std::size_t size) {
    return size >= 2 && data[0] == 0x1F && data[1] == 0x8B;
}

// gzip = 头（10 字节 + 可选字段）+ raw deflate + 8 字节 trailer。
// miniz 的 mz_inflateInit2 只认 zlib 头（15）或裸流（-15），所以这里自己跳过头。
bool gzipDecompress(std::string_view input, std::string& out) {
    auto const* p = reinterpret_cast<std::uint8_t const*>(input.data());
    auto const  n = input.size();
    if (n < 18 || p[0] != 0x1F || p[1] != 0x8B || p[2] != 8) {
        return false;
    }

    auto const  flags = p[3];
    std::size_t pos   = 10;

    if ((flags & 0x04) != 0) { // FEXTRA
        if (pos + 2 > n) {
            return false;
        }
        auto const extraLen = static_cast<std::size_t>(p[pos] | (p[pos + 1] << 8));
        pos += 2 + extraLen;
    }
    if ((flags & 0x08) != 0) { // FNAME
        while (pos < n && p[pos] != 0) {
            ++pos;
        }
        ++pos;
    }
    if ((flags & 0x10) != 0) { // FCOMMENT
        while (pos < n && p[pos] != 0) {
            ++pos;
        }
        ++pos;
    }
    if ((flags & 0x02) != 0) { // FHCRC
        pos += 2;
    }
    if (pos >= n) {
        return false;
    }

    mz_stream stream{};
    if (mz_inflateInit2(&stream, -MZ_DEFAULT_WINDOW_BITS) != MZ_OK) {
        return false;
    }
    stream.next_in  = p + pos;
    stream.avail_in = static_cast<unsigned int>(n - pos);

    constexpr std::size_t kChunk = 256 * 1024;
    std::string           buffer(kChunk, '\0');

    int status = MZ_OK;
    do {
        stream.next_out  = reinterpret_cast<unsigned char*>(buffer.data());
        stream.avail_out = static_cast<unsigned int>(buffer.size());

        status = mz_inflate(&stream, MZ_NO_FLUSH);
        if (status != MZ_OK && status != MZ_STREAM_END) {
            mz_inflateEnd(&stream);
            return false;
        }
        out.append(buffer.data(), buffer.size() - stream.avail_out);
        if (out.size() > (256ull << 20)) {
            mz_inflateEnd(&stream);
            return false;
        }
        if (status == MZ_OK && stream.avail_out == buffer.size() && stream.avail_in == 0) {
            // 输入耗尽但流未结束：文件截断
            mz_inflateEnd(&stream);
            return false;
        }
    } while (status != MZ_STREAM_END);

    mz_inflateEnd(&stream);
    return true;
}

} // namespace

Tag const* Tag::find(std::string_view key) const {
    if (type != TagType::Compound) {
        return nullptr;
    }
    auto const it = compound.find(std::string{key});
    return it == compound.end() ? nullptr : it->second.get();
}

std::int64_t Tag::asInt(std::int64_t def) const {
    switch (type) {
    case TagType::Byte:
    case TagType::Short:
    case TagType::Int:
    case TagType::Long:
        return intValue;
    case TagType::Float:
    case TagType::Double:
        return static_cast<std::int64_t>(doubleValue);
    default:
        return def;
    }
}

double Tag::asDouble(double def) const {
    switch (type) {
    case TagType::Float:
    case TagType::Double:
        return doubleValue;
    case TagType::Byte:
    case TagType::Short:
    case TagType::Int:
    case TagType::Long:
        return static_cast<double>(intValue);
    default:
        return def;
    }
}

std::string const& Tag::asString() const {
    static std::string const empty;
    return type == TagType::String ? stringValue : empty;
}

ParseResult parse(std::uint8_t const* data, std::size_t size, Endian endian) {
    ParseResult result;
    if (data == nullptr || size < 3) {
        result.error = "数据太短，不是 NBT";
        return result;
    }

    Reader reader{data, size, endian};
    auto const rootType = static_cast<TagType>(reader.u8());
    if (rootType != TagType::Compound) {
        result.error = "根标签不是 Compound";
        return result;
    }
    (void)reader.str(); // 根名字通常为空
    result.root = readCompound(reader, 0);
    if (result.root == nullptr || !reader.ok()) {
        result.root.reset();
        result.error = "NBT 结构损坏（越界或类型不合法）";
    }
    return result;
}

ParseResult parseFile(std::filesystem::path const& file, Endian endian) {
    ParseResult result;

    std::error_code ec;
    auto const      size = std::filesystem::file_size(file, ec);
    if (ec) {
        result.error = "无法读取文件大小：" + ec.message();
        return result;
    }
    if (size > (256ull << 20)) {
        result.error = "文件超过 256 MB，拒绝解析";
        return result;
    }

    std::ifstream in(file, std::ios::binary);
    if (!in) {
        result.error = "无法打开文件：" + ::litematicabe::util::toUtf8(file);
        return result;
    }
    std::string raw(static_cast<std::size_t>(size), '\0');
    in.read(raw.data(), static_cast<std::streamsize>(raw.size()));

    auto const* bytes = reinterpret_cast<std::uint8_t const*>(raw.data());

    if (looksLikeGzip(bytes, raw.size())) {
        std::string plain;
        if (!gzipDecompress(std::string_view{raw}, plain)) {
            result.error = "gzip 解压失败（文件损坏或不是 NBT）";
            return result;
        }
        return parse(reinterpret_cast<std::uint8_t const*>(plain.data()), plain.size(), endian);
    }

    return parse(bytes, raw.size(), endian);
}

} // namespace litematicabe::core::nbt
