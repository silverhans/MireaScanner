#include <iostream>
#include <string>
#include <vector>
#include <optional>
#include <chrono>
#include <algorithm>
#include <cmath>
#include <sstream>
#include "nlohmann/json.hpp"

using json = nlohmann::json;

struct Entry {
    std::optional<int64_t> attend_type;
    std::optional<double>  lesson_start_epoch;
};

struct AttendanceCapRequest {
    std::vector<Entry> entries;
    double             current_attendance;
    std::optional<double>  now_epoch;
    std::optional<int64_t> missing_attend_type;
    std::optional<double>  future_skew_seconds;
    std::optional<double>  max_points;
};

struct AttendanceCapResponse {
    bool               ok;
    std::optional<double> cap;
    size_t             recognized;
    size_t             total;
    size_t             missed_past;
    std::optional<std::string> error;
};

static double round2(double v) {
    return std::round(v * 100.0) / 100.0;
}

static double now_unix() {
    using namespace std::chrono;
    return duration_cast<duration<double>>(
        system_clock::now().time_since_epoch()
    ).count();
}

static AttendanceCapRequest parse_request(const json& j) {
    AttendanceCapRequest req;
    req.current_attendance = j.at("current_attendance").get<double>();

    if (j.contains("now_epoch") && !j["now_epoch"].is_null())
        req.now_epoch = j["now_epoch"].get<double>();
    if (j.contains("missing_attend_type") && !j["missing_attend_type"].is_null())
        req.missing_attend_type = j["missing_attend_type"].get<int64_t>();
    if (j.contains("future_skew_seconds") && !j["future_skew_seconds"].is_null())
        req.future_skew_seconds = j["future_skew_seconds"].get<double>();
    if (j.contains("max_points") && !j["max_points"].is_null())
        req.max_points = j["max_points"].get<double>();

    for (const auto& e : j.at("entries")) {
        Entry entry;
        if (e.contains("attend_type") && !e["attend_type"].is_null())
            entry.attend_type = e["attend_type"].get<int64_t>();
        if (e.contains("lesson_start_epoch") && !e["lesson_start_epoch"].is_null())
            entry.lesson_start_epoch = e["lesson_start_epoch"].get<double>();
        req.entries.push_back(entry);
    }
    return req;
}

static json response_to_json(const AttendanceCapResponse& r) {
    json j;
    j["ok"]          = r.ok;
    j["cap"]         = r.cap.has_value() ? json(r.cap.value()) : json(nullptr);
    j["recognized"]  = r.recognized;
    j["total"]       = r.total;
    j["missed_past"] = r.missed_past;
    j["error"]       = r.error.has_value() ? json(r.error.value()) : json(nullptr);
    return j;
}

static AttendanceCapResponse compute_cap(const AttendanceCapRequest& req) {
    size_t total = req.entries.size();
    if (total == 0)
        return {false, std::nullopt, 0, 0, 0, "no entries"};

    double   now              = req.now_epoch.value_or(now_unix());
    int64_t  missing_type     = req.missing_attend_type.value_or(1);
    double   future_skew      = req.future_skew_seconds.value_or(120.0);
    double   max_pts          = req.max_points.value_or(30.0);

    size_t recognized = 0, missed_past = 0;
    for (const auto& e : req.entries) {
        if (!e.attend_type.has_value()) continue;
        ++recognized;
        if (e.attend_type.value() != missing_type) continue;
        if (!e.lesson_start_epoch.has_value()) continue;
        if (e.lesson_start_epoch.value() <= now + future_skew)
            ++missed_past;
    }

    size_t min_recognized = std::max<size_t>(1, (size_t)(total * 0.2));
    if (recognized < min_recognized)
        return {false, std::nullopt, recognized, total, missed_past, "insufficient recognized entries"};

    double remain  = (double)(total - std::min(missed_past, total));
    double cap_est = max_pts * remain / (double)total;
    cap_est = std::max(cap_est, req.current_attendance);
    cap_est = std::min(cap_est, max_pts);
    cap_est = std::max(cap_est, 0.0);

    return {true, round2(cap_est), recognized, total, missed_past, std::nullopt};
}

static void write_error(const std::string& msg) {
    json j;
    j["ok"] = false; j["cap"] = nullptr; j["recognized"] = 0;
    j["total"] = 0; j["missed_past"] = 0; j["error"] = msg;
    std::cout << j.dump() << "\n";
}

int main() {
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                       std::istreambuf_iterator<char>());
    if (std::cin.bad()) {
        write_error("failed to read stdin");
        return 1;
    }

    json j;
    try {
        j = json::parse(input);
    } catch (const std::exception& e) {
        write_error(std::string("bad json: ") + e.what());
        return 1;
    }

    AttendanceCapRequest req;
    try {
        req = parse_request(j);
    } catch (const std::exception& e) {
        write_error(std::string("bad json: ") + e.what());
        return 1;
    }

    auto resp = compute_cap(req);
    std::cout << response_to_json(resp).dump() << "\n";
    return resp.ok ? 0 : 1;
}
