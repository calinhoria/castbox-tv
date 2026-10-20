cmake_minimum_required(VERSION 3.22.1)
project(castboxtv LANGUAGES CXX)

# The visualiser engine lives once at the repo root and is shared verbatim with
# the WebAssembly build (visualizer/engine/src). One source, two backends.
set(VZE_SRC ${CMAKE_CURRENT_SOURCE_DIR}/../../../../visualizer/engine/src)

add_library(jniwrapper SHARED projectm-jni.cpp vze-jni.cpp ${VZE_SRC}/vze.cpp)

add_library(projectM4 SHARED IMPORTED)
set_target_properties(projectM4 PROPERTIES IMPORTED_LOCATION
        ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libprojectM-4.so)

find_library(log-lib log)

target_include_directories(jniwrapper PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include ${VZE_SRC})

target_link_libraries(jniwrapper ${log-lib} GLESv3 projectM4)
