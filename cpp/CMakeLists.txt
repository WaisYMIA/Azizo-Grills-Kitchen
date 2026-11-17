cmake_minimum_required(VERSION 3.10.2)
project(azizo-node)

# libnode.so (Node.js 18 for Android, from the nodejs-mobile project) is downloaded by `npm run sync`
# into android/app/nodejs-runtime/libnode (see scripts/prepare-node.js).
set(NODE_DIR ${CMAKE_SOURCE_DIR}/../../../nodejs-runtime/libnode)

add_library(azizo-node SHARED native-lib.cpp)
include_directories(${NODE_DIR}/include/node/)

add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION ${NODE_DIR}/bin/${ANDROID_ABI}/libnode.so)

find_library(log-lib log)
target_link_libraries(azizo-node libnode ${log-lib})
