#include <iostream>
#include <string>
#include <vector>
#include <unordered_set>
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

// --- Protobuf wire format ---

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

// --- UUID validator ---

static inline bool is_hex(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

static bool is_uuid(const char* s, size_t len) {
    // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  (36 chars)
    if (len != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (s[i] != '-') return false;
        } else {
            if (!is_hex(s[i])) return false;
        }
    }
    return true;
}

// --- Trim whitespace (ASCII) ---

static void trim_bounds(const char* s, size_t len, size_t& start, size_t& end) {
    start = 0;
    end = len;
    while (start < end && static_cast<unsigned char>(s[start]) <= ' ') ++start;
    while (end > start && static_cast<unsigned char>(s[end - 1]) <= ' ') --end;
}

// --- Iterative UUID extraction using explicit stack ---

struct StackFrame {
    const uint8_t* buf;
    size_t len;
    size_t pos;
    int depth;
};

static constexpr int MAX_STACK = 10000;
static constexpr size_t MAX_UUIDS = 10000;

static json extract_uuids(const std::vector<uint8_t>& buf, int max_depth) {
    std::vector<std::string> found;
    std::unordered_set<std::string> seen;
    std::vector<StackFrame> stack;
    stack.push_back({buf.data(), buf.size(), 0, 0});

    while (!stack.empty() && found.size() < MAX_UUIDS) {
        if (static_cast<int>(stack.size()) > MAX_STACK) break;

        auto& frame = stack.back();
        bool done = false;

        while (frame.pos < frame.len) {
            uint64_t key;
            if (!decode_varint(frame.buf, frame.len, frame.pos, key)) {
                done = true;
                break;
            }
            if (frame.pos >= frame.len) {
                done = true;
                break;
            }
            unsigned wt = static_cast<unsigned>(key & 0x7);

            if (wt == 2) {
                uint64_t length;
                if (!decode_varint(frame.buf, frame.len, frame.pos, length)) {
                    done = true;
                    break;
                }
                size_t slen = static_cast<size_t>(length);
                if (frame.pos + slen > frame.len) {
                    done = true;
                    break;
                }

                const uint8_t* field_data = frame.buf + frame.pos;
                frame.pos += slen;

                // Try to decode as UTF-8 string and check UUID
                if (slen > 0 && slen <= 200) {
                    const char* raw = reinterpret_cast<const char*>(field_data);
                    size_t ts, te;
                    trim_bounds(raw, slen, ts, te);
                    size_t trimmed_len = te - ts;
                    if (is_uuid(raw + ts, trimmed_len)) {
                        std::string uuid(raw + ts, trimmed_len);
                        if (seen.find(uuid) == seen.end()) {
                            seen.insert(uuid);
                            found.push_back(uuid);
                        }
                    }
                }

                // Recurse into nested message
                if (slen >= 2 && frame.depth < max_depth) {
                    stack.push_back({field_data, slen, 0, frame.depth + 1});
                    goto next_frame;
                }
                continue;
            }

            if (!skip_field(frame.buf, frame.len, frame.pos, wt)) {
                done = true;
                break;
            }
        }

        done = true;
next_frame:
        if (done || frame.pos >= frame.len) {
            // Only pop if we're done, not if we pushed a new frame
            if (done) stack.pop_back();
        }
    }

    json arr = json::array();
    for (const auto& u : found) arr.push_back(u);
    return arr;
}

static void write_error(const std::string& msg) {
    json j;
    j["ok"] = false;
    j["results"] = json::array();
    j["error"] = msg;
    std::cout << j.dump() << "\n";
}

static constexpr size_t MAX_INPUT_BYTES = 10 * 1024 * 1024;
static constexpr size_t MAX_OPS = 500;
static constexpr size_t MAX_SINGLE_BUFFER = 5 * 1024 * 1024;

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
        int max_depth = 6;

        try {
            data_b64 = op.at("data_b64").get<std::string>();
            if (op.contains("max_depth") && !op["max_depth"].is_null())
                max_depth = op["max_depth"].get<int>();
        } catch (const std::exception&) {
            results.push_back(json::array());
            continue;
        }

        if (max_depth < 0) max_depth = 0;
        if (max_depth > 20) max_depth = 20;

        std::vector<uint8_t> buf;
        if (!b64_decode(data_b64, buf) || buf.size() > MAX_SINGLE_BUFFER) {
            results.push_back(json::array());
            continue;
        }

        results.push_back(extract_uuids(buf, max_depth));
    }

    json out;
    out["ok"] = true;
    out["results"] = results;
    out["error"] = nullptr;
    std::cout << out.dump() << "\n";
    return 0;
}
