#include <iostream>
#include <string>
#include <vector>
#include <cstdint>
#include <cstddef>
#include "nlohmann/json.hpp"

using json = nlohmann::json;

// --- Base64 decoder (RFC 4648) ---

static const int8_t B64_TABLE[256] = {
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
    52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1,
    -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
    15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
    -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
    41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
};

static bool b64_decode(const std::string& in, std::vector<uint8_t>& out) {
    out.clear();
    out.reserve(in.size() * 3 / 4);
    uint32_t accum = 0;
    int bits = 0;
    for (unsigned char ch : in) {
        if (ch == '=' || ch == '\n' || ch == '\r' || ch == ' ') continue;
        int8_t val = B64_TABLE[ch];
        if (val < 0) return false;
        accum = (accum << 6) | static_cast<uint32_t>(val);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<uint8_t>((accum >> bits) & 0xFF));
        }
    }
    return true;
}

// --- Protobuf wire format helpers ---

static bool decode_varint(const uint8_t* data, size_t len, size_t& pos, uint64_t& result) {
    result = 0;
    unsigned shift = 0;
    while (pos < len) {
        uint8_t b = data[pos++];
        result |= static_cast<uint64_t>(b & 0x7F) << shift;
        if (!(b & 0x80)) return true;
        shift += 7;
        if (shift > 70) break;
    }
    return false;
}

static bool skip_field(const uint8_t* data, size_t len, size_t& pos, unsigned wire_type) {
    if (wire_type == 0) {
        uint64_t dummy;
        return decode_varint(data, len, pos, dummy);
    }
    if (wire_type == 1) {
        if (pos + 8 > len) return false;
        pos += 8;
        return true;
    }
    if (wire_type == 5) {
        if (pos + 4 > len) return false;
        pos += 4;
        return true;
    }
    if (wire_type == 2) {
        uint64_t length;
        if (!decode_varint(data, len, pos, length)) return false;
        if (pos + length > len) return false;
        pos += static_cast<size_t>(length);
        return true;
    }
    return false;
}

// --- Trim whitespace (ASCII) ---

static std::string trim(const std::string& s) {
    size_t start = 0;
    while (start < s.size() && static_cast<unsigned char>(s[start]) <= ' ') ++start;
    size_t end = s.size();
    while (end > start && static_cast<unsigned char>(s[end - 1]) <= ' ') --end;
    return s.substr(start, end - start);
}

// --- parse_string_field: extract first string at given field number ---

static json parse_string_field(const std::vector<uint8_t>& buf, uint32_t field_no) {
    const uint8_t* data = buf.data();
    size_t len = buf.size();
    size_t pos = 0;

    while (pos < len) {
        uint64_t key;
        if (!decode_varint(data, len, pos, key)) break;
        uint32_t field = static_cast<uint32_t>(key >> 3);
        unsigned wt = static_cast<unsigned>(key & 0x7);

        if (field == field_no && wt == 2) {
            uint64_t length;
            if (!decode_varint(data, len, pos, length)) break;
            size_t slen = static_cast<size_t>(length);
            if (pos + slen > len) break;
            std::string raw(reinterpret_cast<const char*>(data + pos), slen);
            std::string trimmed = trim(raw);
            if (trimmed.empty()) return json(nullptr);
            return json(trimmed);
        }
        if (!skip_field(data, len, pos, wt)) break;
    }
    return json(nullptr);
}

static void write_error(const std::string& msg) {
    json j;
    j["ok"] = false;
    j["results"] = json::array();
    j["error"] = msg;
    std::cout << j.dump() << "\n";
}

static constexpr size_t MAX_INPUT_BYTES = 10 * 1024 * 1024;  // 10 MB
static constexpr size_t MAX_OPS = 2000;
static constexpr size_t MAX_SINGLE_BUFFER = 1024 * 1024;  // 1 MB

int main() {
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                       std::istreambuf_iterator<char>());
    if (std::cin.bad()) {
        write_error("failed to read stdin");
        return 1;
    }
    if (input.size() > MAX_INPUT_BYTES) {
        write_error("input too large");
        return 1;
    }

    json j;
    try {
        j = json::parse(input);
    } catch (const std::exception& e) {
        write_error(std::string("bad json: ") + e.what());
        return 1;
    }

    if (!j.contains("operations") || !j["operations"].is_array()) {
        write_error("missing 'operations' array");
        return 1;
    }

    const auto& ops = j["operations"];
    if (ops.size() > MAX_OPS) {
        write_error("too many operations");
        return 1;
    }

    json results = json::array();

    for (const auto& op : ops) {
        std::string data_b64;
        uint32_t field_no = 0;

        try {
            data_b64 = op.at("data_b64").get<std::string>();
            field_no = op.at("field_no").get<uint32_t>();
        } catch (const std::exception&) {
            results.push_back(nullptr);
            continue;
        }

        std::vector<uint8_t> buf;
        if (!b64_decode(data_b64, buf) || buf.size() > MAX_SINGLE_BUFFER) {
            results.push_back(nullptr);
            continue;
        }

        results.push_back(parse_string_field(buf, field_no));
    }

    json out;
    out["ok"] = true;
    out["results"] = results;
    out["error"] = nullptr;
    std::cout << out.dump() << "\n";
    return 0;
}
