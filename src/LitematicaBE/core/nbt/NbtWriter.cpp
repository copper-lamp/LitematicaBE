#include "LitematicaBE/core/nbt/NbtWriter.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include <miniz/miniz.h>

#include <cstring>
#include <fstream>
#include <system_error>

namespace litematicabe::core::nbt {

namespace {

// 一层 NBT 写入器：只做「按字节序追加」，结构在 `writePayload` 里递归。
class Writer {
public:
    explicit Writer(Endian endian) : mBig(endian == Endian::Big) {}

    [[nodiscard]] bool ok() const noexcept { return mOk; }
    [[nodiscard]] std::vector<std::uint8_t> take() { return std::move(mBuffer); }

    void u8(std::uint8_t value) { mBuffer.push_back(value); }

    void u16(std::uint16_t value) {
        if (mBig) {
            mBuffer.push_back(static_cast<std::uint8_t>(value >> 8));
            mBuffer.push_back(static_cast<std::uint8_t>(value & 0xFF));
        } else {
            mBuffer.push_back(static_cast<std::uint8_t>(value & 0xFF));
            mBuffer.push_back(static_cast<std::uint8_t>(value >> 8));
        }
    }

    void u32(std::uint32_t value) {
        for (int i = 0; i < 4; ++i) {
            auto const shift = mBig ? 8 * (3 - i) : 8 * i;
            mBuffer.push_back(static_cast<std::uint8_t>((value >> shift) & 0xFF));
        }
    }

    void u64(std::uint64_t value) {
        for (int i = 0; i < 8; ++i) {
            auto const shift = mBig ? 8 * (7 - i) : 8 * i;
            mBuffer.push_back(static_cast<std::uint8_t>((value >> shift) & 0xFF));
        }
    }

    // NBT 的字符串是「u16 字节长度 + UTF-8 字节」。
    void str(std::string const& value) {
        auto const length = static_cast<std::uint16_t>(value.size() > 0xFFFF ? 0xFFFF : value.size());
        u16(length);
        mBuffer.insert(mBuffer.end(), value.begin(), value.begin() + length);
    }

    bool writeRoot(Tag const& root) {
        if (root.type != TagType::Compound) {
            mOk = false;
            return false;
        }
        u8(static_cast<std::uint8_t>(TagType::Compound));
        str({}); // 根名字（Litematica / 结构方块都写空串）
        writeCompoundBody(root, 0);
        return mOk;
    }

private:
    void writeCompoundBody(Tag const& tag, int depth) {
        if (depth > 64) {
            mOk = false;
            return;
        }
        for (auto const& [name, child] : tag.compound) {
            if (!child) {
                continue;
            }
            u8(static_cast<std::uint8_t>(child->type));
            str(name);
            writePayload(*child, depth + 1);
            if (!mOk) {
                return;
            }
        }
        u8(static_cast<std::uint8_t>(TagType::End));
    }

    void writePayload(Tag const& tag, int depth) {
        if (depth > 64) {
            mOk = false;
            return;
        }

        switch (tag.type) {
        case TagType::Byte:
            u8(static_cast<std::uint8_t>(static_cast<std::int8_t>(tag.intValue)));
            break;
        case TagType::Short:
            u16(static_cast<std::uint16_t>(static_cast<std::int16_t>(tag.intValue)));
            break;
        case TagType::Int:
            u32(static_cast<std::uint32_t>(static_cast<std::int32_t>(tag.intValue)));
            break;
        case TagType::Long:
            u64(static_cast<std::uint64_t>(tag.intValue));
            break;
        case TagType::Float: {
            auto const value = static_cast<float>(tag.doubleValue);
            std::uint32_t bits{};
            static_assert(sizeof(bits) == sizeof(value));
            std::memcpy(&bits, &value, sizeof(bits));
            u32(bits);
            break;
        }
        case TagType::Double: {
            std::uint64_t bits{};
            static_assert(sizeof(bits) == sizeof(tag.doubleValue));
            std::memcpy(&bits, &tag.doubleValue, sizeof(bits));
            u64(bits);
            break;
        }
        case TagType::ByteArray: {
            u32(static_cast<std::uint32_t>(tag.byteArray.size()));
            mBuffer.insert(mBuffer.end(), tag.byteArray.begin(), tag.byteArray.end());
            break;
        }
        case TagType::String:
            str(tag.stringValue);
            break;
        case TagType::List: {
            u8(static_cast<std::uint8_t>(tag.listType));
            u32(static_cast<std::uint32_t>(tag.list.size()));
            for (auto const& child : tag.list) {
                if (!child) {
                    // 空元素在 NBT 里没有表示法：当成写坏，别产出半截文件。
                    mOk = false;
                    return;
                }
                writePayload(*child, depth + 1);
                if (!mOk) {
                    return;
                }
            }
            break;
        }
        case TagType::Compound:
            writeCompoundBody(tag, depth);
            break;
        case TagType::IntArray: {
            u32(static_cast<std::uint32_t>(tag.longArray.size()));
            for (auto const value : tag.longArray) {
                u32(static_cast<std::uint32_t>(value));
            }
            break;
        }
        case TagType::LongArray: {
            u32(static_cast<std::uint32_t>(tag.longArray.size()));
            for (auto const value : tag.longArray) {
                u64(value);
            }
            break;
        }
        case TagType::End:
        default:
            mOk = false;
            break;
        }
    }

    std::vector<std::uint8_t> mBuffer;
    bool                      mBig{true};
    bool                      mOk{true};
};

} // namespace

std::vector<std::uint8_t> serialize(Tag const& root, Endian endian) {
    Writer writer{endian};
    if (!writer.writeRoot(root)) {
        return {};
    }
    return writer.take();
}

std::vector<std::uint8_t> gzipCompress(std::uint8_t const* data, std::size_t size) {
    if (data == nullptr && size != 0) {
        return {};
    }

    mz_stream stream{};
    // raw deflate（-15）：gzip 头与 trailer 由本函数自己拼，与解压侧的跳头逻辑对称。
    if (mz_deflateInit2(
            &stream,
            MZ_BEST_COMPRESSION,
            MZ_DEFLATED,
            -MZ_DEFAULT_WINDOW_BITS,
            9,
            MZ_DEFAULT_STRATEGY
        )
        != MZ_OK) {
        return {};
    }

    std::vector<std::uint8_t> body;
    std::vector<std::uint8_t> chunk(256 * 1024, 0);

    stream.next_in  = const_cast<std::uint8_t*>(data);
    stream.avail_in = static_cast<unsigned int>(size);

    int status = MZ_OK;
    do {
        stream.next_out  = chunk.data();
        stream.avail_out = static_cast<unsigned int>(chunk.size());

        status = mz_deflate(&stream, MZ_FINISH);
        if (status != MZ_OK && status != MZ_STREAM_END && status != MZ_BUF_ERROR) {
            mz_deflateEnd(&stream);
            return {};
        }
        body.insert(body.end(), chunk.begin(), chunk.begin() + (static_cast<std::ptrdiff_t>(chunk.size()) - stream.avail_out));
    } while (status != MZ_STREAM_END);

    mz_deflateEnd(&stream);

    std::vector<std::uint8_t> out;
    out.reserve(body.size() + 18);
    // gzip 头：magic / deflate / flags=0 / mtime=0 / xfl=2 / os=255(unknown)
    out.push_back(0x1F);
    out.push_back(0x8B);
    out.push_back(0x08);
    out.push_back(0x00);
    out.push_back(0x00);
    out.push_back(0x00);
    out.push_back(0x00);
    out.push_back(0x00);
    out.push_back(0x02);
    out.push_back(0xFF);
    out.insert(out.end(), body.begin(), body.end());

    auto const crc     = static_cast<std::uint32_t>(mz_crc32(0, data, size));
    auto const isize   = static_cast<std::uint32_t>(size);
    out.push_back(static_cast<std::uint8_t>(crc & 0xFF));
    out.push_back(static_cast<std::uint8_t>((crc >> 8) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((crc >> 16) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((crc >> 24) & 0xFF));
    out.push_back(static_cast<std::uint8_t>(isize & 0xFF));
    out.push_back(static_cast<std::uint8_t>((isize >> 8) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((isize >> 16) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((isize >> 24) & 0xFF));
    return out;
}

std::vector<std::uint8_t> gzipCompress(std::vector<std::uint8_t> const& data) {
    return gzipCompress(data.data(), data.size());
}

bool writeFile(std::filesystem::path const& file, std::vector<std::uint8_t> const& bytes, std::string& error) {
    std::error_code ec;
    if (auto const parent = file.parent_path(); !parent.empty()) {
        std::filesystem::create_directories(parent, ec);
        if (ec) {
            error = "创建目录失败：" + ec.message();
            return false;
        }
    }

    auto const tmp = std::filesystem::path{file}.concat(".tmp");

    {
        std::ofstream out{tmp, std::ios::binary | std::ios::trunc};
        if (!out) {
            error = "无法写入：" + ::litematicabe::util::toUtf8(tmp);
            return false;
        }
        out.write(reinterpret_cast<char const*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        if (!out) {
            error = "写入中断：" + ::litematicabe::util::toUtf8(tmp);
            return false;
        }
    }

    // Windows 的 rename 不会覆盖已存在的目标，先删掉再改名。
    std::filesystem::remove(file, ec);
    std::filesystem::rename(tmp, file, ec);
    if (ec) {
        error = "替换文件失败：" + ec.message();
        std::filesystem::remove(tmp, ec);
        return false;
    }
    return true;
}

// ───────────────────────────── 构造助手 ─────────────────────────────

TagPtr makeCompound() {
    auto tag   = std::make_shared<Tag>();
    tag->type = TagType::Compound;
    return tag;
}

TagPtr makeList(TagType elementType) {
    auto tag      = std::make_shared<Tag>();
    tag->type     = TagType::List;
    tag->listType = elementType;
    return tag;
}

TagPtr makeByte(std::int64_t value) {
    auto tag      = std::make_shared<Tag>();
    tag->type     = TagType::Byte;
    tag->intValue = value;
    return tag;
}

TagPtr makeShort(std::int64_t value) {
    auto tag      = std::make_shared<Tag>();
    tag->type     = TagType::Short;
    tag->intValue = value;
    return tag;
}

TagPtr makeInt(std::int64_t value) {
    auto tag      = std::make_shared<Tag>();
    tag->type     = TagType::Int;
    tag->intValue = value;
    return tag;
}

TagPtr makeLong(std::int64_t value) {
    auto tag      = std::make_shared<Tag>();
    tag->type     = TagType::Long;
    tag->intValue = value;
    return tag;
}

TagPtr makeFloat(double value) {
    auto tag         = std::make_shared<Tag>();
    tag->type        = TagType::Float;
    tag->doubleValue = value;
    return tag;
}

TagPtr makeDouble(double value) {
    auto tag         = std::make_shared<Tag>();
    tag->type        = TagType::Double;
    tag->doubleValue = value;
    return tag;
}

TagPtr makeString(std::string value) {
    auto tag          = std::make_shared<Tag>();
    tag->type         = TagType::String;
    tag->stringValue  = std::move(value);
    return tag;
}

TagPtr makeByteArray(std::vector<std::uint8_t> values) {
    auto tag        = std::make_shared<Tag>();
    tag->type       = TagType::ByteArray;
    tag->byteArray  = std::move(values);
    return tag;
}

TagPtr makeIntArray(std::vector<std::int32_t> values) {
    auto tag      = std::make_shared<Tag>();
    tag->type     = TagType::IntArray;
    tag->longArray.reserve(values.size());
    for (auto const value : values) {
        // IntArray 与 LongArray 共用 `longArray` 存储（无符号存放，写端按类型截断/扩展）。
        tag->longArray.push_back(static_cast<std::uint32_t>(value));
    }
    return tag;
}

TagPtr makeLongArray(std::vector<std::uint64_t> values) {
    auto tag       = std::make_shared<Tag>();
    tag->type      = TagType::LongArray;
    tag->longArray = std::move(values);
    return tag;
}

void put(Tag& compound, std::string key, TagPtr value) {
    if (!value) {
        return;
    }
    compound.compound[std::move(key)] = std::move(value);
}

} // namespace litematicabe::core::nbt
