// JNI bridge for the shared vze visualiser engine (visualizer/engine/src/vze.cpp).
//
// The exact same engine source that compiles to WebAssembly for the browser
// also compiles here for Android; this file only marshals strings, direct
// buffers and the flat draw-command stream across the JNI boundary. It is
// deliberately dumb: no rendering, no preset knowledge.
#include <jni.h>

#include <string>

#include "vze.h"

namespace {

std::string jstr(JNIEnv* env, jstring s) {
    if (!s) return std::string();
    const char* c = env->GetStringUTFChars(s, nullptr);
    std::string out = c ? c : "";
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

jobject direct(JNIEnv* env, void* ptr, jlong bytes) {
    if (!ptr || bytes <= 0) return nullptr;
    return env->NewDirectByteBuffer(ptr, bytes);
}

}  // namespace

extern "C" {

JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeInit(JNIEnv*, jobject) {
    vze_reset();
}

JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeCmdStride(JNIEnv*, jobject) {
    return vze_cmd_stride();
}
JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeBandCount(JNIEnv*, jobject) {
    return vze_band_count();
}
JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeAudioWindow(JNIEnv*, jobject) {
    return vze_audio_window();
}
JNIEXPORT jstring JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeVersion(JNIEnv* env, jobject) {
    return env->NewStringUTF(vze_version());
}

JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeSetSurface(JNIEnv*, jobject, jint w, jint h) {
    vze_set_surface(w, h);
}
JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeSetAudioRate(JNIEnv*, jobject, jint sr) {
    vze_set_audio_rate(sr);
}

JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeTypeId(JNIEnv* env, jobject, jstring name) {
    std::string s = jstr(env, name);
    return vze_type_id(s.c_str(), (int)s.size());
}
JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativePropId(JNIEnv* env, jobject, jstring name) {
    std::string s = jstr(env, name);
    return vze_prop_id(s.c_str(), (int)s.size());
}

JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeSceneClear(JNIEnv*, jobject) {
    vze_scene_clear();
}
JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeSceneAdd(JNIEnv*, jobject, jint typeId) {
    return vze_scene_add(typeId);
}
JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeSceneCount(JNIEnv*, jobject) {
    return vze_scene_count();
}
JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeSceneSetNum(JNIEnv*, jobject, jint index, jint prop, jfloat v) {
    vze_scene_set_num(index, prop, v);
}
JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeSceneSetStr(JNIEnv* env, jobject, jint index, jint prop, jstring value) {
    std::string s = jstr(env, value);
    vze_scene_set_str(index, prop, s.c_str(), (int)s.size());
}

JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeVarSet(JNIEnv* env, jobject, jstring name, jstring value) {
    std::string n = jstr(env, name);
    std::string v = jstr(env, value);
    vze_var_set(n.c_str(), (int)n.size(), v.c_str(), (int)v.size());
}
JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeVarSetNumber(JNIEnv* env, jobject, jstring name, jfloat value) {
    std::string n = jstr(env, name);
    vze_var_set_number(n.c_str(), (int)n.size(), value);
}

JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeCoverSet(JNIEnv*, jobject, jint id) {
    vze_cover_set(id);
}
JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeImageSet(JNIEnv*, jobject, jint id, jfloat w, jfloat h) {
    vze_image_set(id, w, h);
}

JNIEXPORT jobject JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeAudioBuffer(JNIEnv* env, jobject) {
    return direct(env, vze_audio_buffer(), (jlong)vze_audio_window() * 4);
}
JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeAudioCommit(JNIEnv*, jobject, jint samples) {
    vze_audio_commit(samples);
}

JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeFrame(JNIEnv*, jobject, jfloat dtMs) {
    vze_frame(dtMs);
}

JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeCmdCount(JNIEnv*, jobject) {
    return vze_cmd_count();
}
JNIEXPORT jobject JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeCmdData(JNIEnv* env, jobject) {
    return direct(env, vze_cmd_data(),
                  (jlong)vze_cmd_capacity() * vze_cmd_stride() * 4);
}
JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativePointCount(JNIEnv*, jobject) {
    return vze_point_count();
}
JNIEXPORT jobject JNICALL Java_com_castboxtv_app_viz_VizEngine_nativePointData(JNIEnv* env, jobject) {
    return direct(env, vze_point_data(), (jlong)vze_point_count() * 2 * 4);
}
JNIEXPORT jobject JNICALL Java_com_castboxtv_app_viz_VizEngine_nativePoolData(JNIEnv* env, jobject) {
    return direct(env, const_cast<char*>(vze_pool_data()), (jlong)vze_pool_capacity());
}
JNIEXPORT jint JNICALL Java_com_castboxtv_app_viz_VizEngine_nativePoolLen(JNIEnv*, jobject) {
    return vze_pool_len();
}

JNIEXPORT void JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeMeasurePut(JNIEnv*, jobject, jint strId, jfloat width) {
    vze_measure_put(strId, width);
}

JNIEXPORT jfloat JNICALL Java_com_castboxtv_app_viz_VizEngine_nativeLevel(JNIEnv*, jobject, jint source) {
    return vze_level(source);
}

}  // extern "C"
