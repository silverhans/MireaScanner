deps:
	mkdir -p attendance_core/nlohmann
	curl -sL https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp \
	  -o attendance_core/nlohmann/json.hpp

build: deps
	cd attendance_core && g++ -std=c++17 -O2 -I. main.cpp -o attendance_core_cpp
	cd uuid_core       && g++ -std=c++17 -O2 -I../attendance_core main.cpp -o uuid_core
	cd zone_core       && g++ -std=c++17 -O2 -I../attendance_core main.cpp -o zone_core
	cd protobuf_core   && g++ -std=c++17 -O2 -I../attendance_core main.cpp -o protobuf_core

clean:
	rm -f attendance_core/attendance_core_cpp
	rm -f uuid_core/uuid_core
	rm -f zone_core/zone_core
	rm -f protobuf_core/protobuf_core
	rm -f attendance_core/nlohmann/json.hpp

.PHONY: deps build clean
