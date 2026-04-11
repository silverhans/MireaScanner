#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
#include <cstdint>
#include <cstddef>
#include <unordered_set>
#include "nlohmann/json.hpp"

using json = nlohmann::json;

// --- UTF-8 aware helpers ---

static std::string to_lower_utf8(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    size_t i = 0;
    while (i < s.size()) {
        unsigned char c = static_cast<unsigned char>(s[i]);
        // ASCII lowercase
        if (c >= 'A' && c <= 'Z') {
            out.push_back(static_cast<char>(c + 32));
            ++i;
            continue;
        }
        // Russian uppercase: У+0410..У+042F -> У+0430..У+044F (2-byte UTF-8)
        // 0x0410 = D0 90, 0x042F = D0 AF -> 0x0430 = D0 B0, 0x044F = D0 BF
        if (c == 0xD0 && i + 1 < s.size()) {
            unsigned char c2 = static_cast<unsigned char>(s[i + 1]);
            if (c2 >= 0x90 && c2 <= 0x9F) {
                // А-П -> а-п: D0 90-9F -> D0 B0-BF
                out.push_back(static_cast<char>(0xD0));
                out.push_back(static_cast<char>(c2 + 0x20));
                i += 2;
                continue;
            }
            if (c2 >= 0xA0 && c2 <= 0xAF) {
                // Р-Я -> р-я: D0 A0-AF -> D1 80-8F
                out.push_back(static_cast<char>(0xD1));
                out.push_back(static_cast<char>(c2 - 0x20));
                i += 2;
                continue;
            }
        }
        // Ё (D0 81) -> ё (D1 91)
        if (c == 0xD0 && i + 1 < s.size() && static_cast<unsigned char>(s[i + 1]) == 0x81) {
            out.push_back(static_cast<char>(0xD1));
            out.push_back(static_cast<char>(0x91));
            i += 2;
            continue;
        }
        out.push_back(s[i]);
        ++i;
    }
    return out;
}

static std::string trim(const std::string& s) {
    size_t start = 0;
    while (start < s.size() && static_cast<unsigned char>(s[start]) <= ' ') ++start;
    size_t end = s.size();
    while (end > start && static_cast<unsigned char>(s[end - 1]) <= ' ') --end;
    return s.substr(start, end - start);
}

static std::string collapse_ws(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    bool prev_space = false;
    for (char c : s) {
        bool is_ws = (c == ' ' || c == '\t' || c == '\n' || c == '\r');
        if (is_ws) {
            if (!prev_space) out.push_back(' ');
            prev_space = true;
        } else {
            out.push_back(c);
            prev_space = false;
        }
    }
    return out;
}

// --- Hex/UUID checks ---

static inline bool is_hex(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

static inline bool is_alnum_ascii(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

static bool is_uuid(const std::string& s) {
    if (s.size() != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (s[i] != '-') return false;
        } else {
            if (!is_hex(s[i])) return false;
        }
    }
    return true;
}

static bool contains_uuid(const std::string& s) {
    if (s.size() < 36) return false;
    for (size_t i = 0; i + 36 <= s.size(); ++i) {
        if (i > 0 && s[i - 1] != '-' && is_hex(s[i - 1])) continue;
        if (is_uuid(s.substr(i, 36))) return true;
    }
    return false;
}

static bool is_hex_token(const std::string& s) {
    if (s.size() < 24) return false;
    for (char c : s) {
        if (!is_hex(c) && c != '-') return false;
    }
    return true;
}

static bool is_long_single_token(const std::string& s) {
    if (s.size() < 28) return false;
    if (s.find(' ') != std::string::npos) return false;
    for (char c : s) {
        if (!is_alnum_ascii(c) && c != '_' && c != '-') return false;
    }
    return true;
}

// --- Strip leading non-alphanumeric (ASCII + Cyrillic) ---

static std::string strip_leading_non_alnum(const std::string& s) {
    size_t i = 0;
    while (i < s.size()) {
        unsigned char c = static_cast<unsigned char>(s[i]);
        // ASCII digit or letter
        if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) break;
        // Cyrillic (2-byte UTF-8: 0xD0 or 0xD1 prefix)
        if ((c == 0xD0 || c == 0xD1) && i + 1 < s.size()) {
            unsigned char c2 = static_cast<unsigned char>(s[i + 1]);
            if (c2 >= 0x80 && c2 <= 0xBF) break;
        }
        ++i;
    }
    return trim(s.substr(i));
}

// --- is_technical_token ---

static bool is_technical_token(const std::string& text) {
    std::string value = trim(text);
    if (value.empty()) return true;
    std::string normalized = strip_leading_non_alnum(value);
    if (normalized.empty()) return true;
    if (contains_uuid(normalized)) return true;
    if (is_uuid(normalized)) return true;
    if (is_hex_token(normalized)) return true;
    if (is_long_single_token(normalized)) return true;
    return false;
}

// --- has_alpha ---

static bool has_alpha(const std::string& s) {
    for (size_t i = 0; i < s.size(); ++i) {
        unsigned char c = static_cast<unsigned char>(s[i]);
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) return true;
        // Cyrillic letters
        if ((c == 0xD0 || c == 0xD1) && i + 1 < s.size()) {
            unsigned char c2 = static_cast<unsigned char>(s[i + 1]);
            if (c2 >= 0x80 && c2 <= 0xBF) return true;
        }
    }
    return false;
}

// --- is_printable (simplified: treat valid UTF-8 multibyte as printable) ---

static bool is_char_printable(unsigned char c) {
    if (c >= 0x20 && c <= 0x7E) return true;  // ASCII printable
    if (c >= 0x80) return true;  // Assume multibyte UTF-8 is printable
    if (c == '\t') return false;
    return false;
}

// --- looks_text ---

static std::string looks_text(const std::string& raw) {
    std::string text = trim(raw);
    text = collapse_ws(text);
    if (text.empty() || text.size() > 140) return "";
    if (text.rfind("http://", 0) == 0 || text.rfind("https://", 0) == 0) return "";

    size_t printable = 0;
    for (unsigned char c : text) {
        if (is_char_printable(c)) ++printable;
    }
    if (static_cast<double>(printable) / std::max(text.size(), size_t(1)) < 0.92) return "";
    if (is_technical_token(text)) return "";
    if (!has_alpha(text)) return "";
    return text;
}

// --- zone_score ---

// UTF-8 encoded Russian keywords
static const std::vector<std::string> ZONE_KEYWORDS = {
    "\xd0\xba\xd0\xbf\xd0\xbf",             // кпп
    "\xd0\xb2\xd1\x85\xd0\xbe\xd0\xb4",     // вход
    "\xd1\x82\xd0\xb5\xd1\x80\xd1\x80\xd0\xb8\xd1\x82",  // террит
    "\xd0\xba\xd0\xbe\xd1\x80\xd0\xbf\xd1\x83\xd1\x81",   // корпус
    "\xd0\xbf\xd1\x80\xd0\xbe\xd1\x85\xd0\xbe\xd0\xb4",   // проход
    "\xd0\xb7\xd0\xbe\xd0\xbd\xd0\xb0",     // зона
};

static bool match_building_code(const std::string& text) {
    // Pattern: [А-ЯA-Z]\d{1,3}
    for (size_t i = 0; i < text.size(); ++i) {
        unsigned char c = static_cast<unsigned char>(text[i]);
        bool is_upper_latin = (c >= 'A' && c <= 'Z');
        bool is_upper_cyrillic = false;
        size_t char_len = 1;

        if (c == 0xD0 && i + 1 < text.size()) {
            unsigned char c2 = static_cast<unsigned char>(text[i + 1]);
            // А-Я: D0 90-AF
            if (c2 >= 0x90 && c2 <= 0xAF) {
                is_upper_cyrillic = true;
                char_len = 2;
            }
        }

        if (is_upper_latin || is_upper_cyrillic) {
            size_t next = i + char_len;
            size_t digits = 0;
            while (next < text.size() && text[next] >= '0' && text[next] <= '9' && digits < 3) {
                ++next;
                ++digits;
            }
            if (digits >= 1 && digits <= 3) return true;
        }
    }
    return false;
}

static int zone_score(const std::string& text) {
    std::string value = trim(text);
    if (value.empty()) return -100;
    if (is_technical_token(value)) return -100;

    int score = 0;
    std::string lower = to_lower_utf8(value);

    for (const auto& kw : ZONE_KEYWORDS) {
        if (lower.find(kw) != std::string::npos) {
            score += 5;
        }
    }

    if (match_building_code(value)) score += 3;
    if (value.size() >= 4 && value.size() <= 64) score += 1;

    return score;
}

// --- Main processing ---

static void write_error(const std::string& msg) {
    json j;
    j["ok"] = false;
    j["results"] = json::array();
    j["error"] = msg;
    std::cout << j.dump() << "\n";
}

static constexpr size_t MAX_INPUT_BYTES = 5 * 1024 * 1024;
static constexpr size_t MAX_EVENTS = 500;
static constexpr size_t MAX_STRINGS = 100;

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

    if (!j.contains("events") || !j["events"].is_array()) {
        write_error("missing 'events' array");
        return 1;
    }

    const auto& events = j["events"];
    if (events.size() > MAX_EVENTS) {
        write_error("too many events");
        return 1;
    }

    // Default unknown zone
    const std::string unknown_zone = "\xd0\x9d\xd0\xb5\xd0\xb8\xd0\xb7\xd0\xb2\xd0\xb5\xd1\x81\xd1\x82\xd0\xbd\xd0\xb0\xd1\x8f \xd0\xb7\xd0\xbe\xd0\xbd\xd0\xb0";  // "Неизвестная зона"

    json results = json::array();

    for (const auto& ev : events) {
        if (!ev.contains("strings") || !ev["strings"].is_array()) {
            results.push_back(nullptr);
            continue;
        }

        const auto& strings_arr = ev["strings"];
        if (strings_arr.size() > MAX_STRINGS) {
            results.push_back(nullptr);
            continue;
        }

        // Deduplicate strings preserving order
        std::vector<std::string> uniq_strings;
        std::unordered_set<std::string> seen;
        for (const auto& s : strings_arr) {
            if (!s.is_string()) continue;
            std::string val = s.get<std::string>();
            std::string checked = looks_text(val);
            if (checked.empty()) continue;
            if (seen.count(checked)) continue;
            seen.insert(checked);
            uniq_strings.push_back(checked);
        }

        if (uniq_strings.empty()) {
            results.push_back(nullptr);
            continue;
        }

        // Sort by zone score descending
        std::vector<std::string> zone_candidates;
        for (const auto& z : uniq_strings) {
            if (zone_score(z) >= 2) zone_candidates.push_back(z);
        }
        std::sort(zone_candidates.begin(), zone_candidates.end(),
                  [](const std::string& a, const std::string& b) {
                      return zone_score(a) > zone_score(b);
                  });

        // Readable (non-technical) strings
        std::vector<std::string> readable;
        for (const auto& z : uniq_strings) {
            if (!is_technical_token(z)) readable.push_back(z);
        }

        std::string enter_zone, exit_zone;
        if (zone_candidates.size() >= 2) {
            enter_zone = zone_candidates[0];
            exit_zone = zone_candidates[1];
        } else if (zone_candidates.size() == 1) {
            enter_zone = zone_candidates[0];
            exit_zone = unknown_zone;
        } else if (readable.size() >= 2) {
            enter_zone = readable[0];
            exit_zone = readable[1];
        } else if (readable.size() == 1) {
            enter_zone = readable[0];
            exit_zone = unknown_zone;
        } else {
            enter_zone = unknown_zone;
            exit_zone = unknown_zone;
        }

        json result;
        result["enter_zone"] = enter_zone;
        result["exit_zone"] = exit_zone;
        results.push_back(result);
    }

    json out;
    out["ok"] = true;
    out["results"] = results;
    out["error"] = nullptr;
    std::cout << out.dump() << "\n";
    return 0;
}
