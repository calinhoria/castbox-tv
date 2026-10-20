#include <android/log.h>
#include <jni.h>
#include <cstdio>
#include <cstring>
#include <vector>
#include <mutex>
#include <ctime>
#include <dirent.h>
#include <algorithm>

#include <GLES3/gl3.h>
#include "projectM-4/projectM.h"
#include "projectM-4/audio.h"
#include "projectM-4/parameters.h"
#include "projectM-4/render_opengl.h"
#include "projectM-4/core.h"

#define TAG "projectM-java"
#define ALOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)
#define ALOGW(...) __android_log_print(ANDROID_LOG_WARN,  TAG, __VA_ARGS__)
#define ALOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define ALOGD(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)

static projectm_handle handle = nullptr;
static std::mutex engineMutex;
static std::string presetsDir;
static std::vector<std::string> presetFiles;  // sorted .milk file names

// Internal render size: tiny by design. 854x480 keeps the 16:9 shape of the
// TV surface (640x480 would stretch 4:3 -> 16:9 and distort), at a fraction
// of the GPU cost. Mesh further cut to keep CPU free for audio decode/crossfade.
static const int kInternalW = 854;
static const int kInternalH = 480;

static GLuint fboObject = 0, fboTexture = 0;
static GLuint blitProgram = 0;
static int fboWidth = 0, fboHeight = 0, surfaceWidth = 0, surfaceHeight = 0;

// Last failed preset load (set by the engine's failure callback, which fires
// synchronously inside projectm_load_preset_file). Lets create()/loadPreset()
// detect broken presets instead of showing a black screen silently.
static std::string lastFailedFile;
static std::string lastFailedMessage;

static void onPresetFailed(const char *filename, const char *message, void *) {
    ALOGE("preset load FAILED: %s: %s",
          filename ? filename : "(null)", message ? message : "(null)");
    lastFailedFile = filename ? filename : "";
    lastFailedMessage = message ? message : "";
}

static const char *kVertSrc =
        "#version 300 es\n"
        "layout(location=0) in vec2 aPos;\n"
        "layout(location=1) in vec2 aUV;\n"
        "out vec2 vUV;\n"
        "void main() { vUV = aUV; gl_Position = vec4(aPos, 0.0, 1.0); }\n";

static const char *kFragSrc =
        "#version 300 es\n"
        "precision highp float;\n"
        "in vec2 vUV;\n"
        "uniform sampler2D uTex;\n"
        "out vec4 outColor;\n"
        "void main() { outColor = texture(uTex, vUV); }\n";


static const GLfloat kQuadVerts[16] = {
        -1.f, -1.f,  0.f, 0.f,   // BL
         1.f, -1.f,  1.f, 0.f,   // BR
        -1.f,  1.f,  0.f, 1.f,   // TL
         1.f,  1.f,  1.f, 1.f,   // TR
};

static GLuint compileShader(GLenum type, const char *src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, nullptr);
    glCompileShader(s);
    GLint ok = GL_FALSE;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (ok != GL_TRUE) {
        char log[512];
        glGetShaderInfoLog(s, sizeof(log), nullptr, log);
        ALOGE("shader compile failed: %s", log);
        glDeleteShader(s);
        return 0;
    }
    return s;
}

static void destroyRenderBuffers() {
    if (fboObject) { glDeleteFramebuffers(1, &fboObject); fboObject = 0; }
    if (fboTexture) { glDeleteTextures(1, &fboTexture); fboTexture = 0; }
    if (blitProgram) { glDeleteProgram(blitProgram); blitProgram = 0; }
    fboWidth = fboHeight = 0;
}

static bool ensureRenderBuffers(int surfaceW, int surfaceH) {
    (void) surfaceW; (void) surfaceH;
    if (blitProgram) return true;

    GLuint vs = compileShader(GL_VERTEX_SHADER, kVertSrc);
    GLuint fs = compileShader(GL_FRAGMENT_SHADER, kFragSrc);
    if (!vs || !fs) { return false; }
    blitProgram = glCreateProgram();
    glAttachShader(blitProgram, vs);
    glAttachShader(blitProgram, fs);
    glLinkProgram(blitProgram);
    glDeleteShader(vs);
    glDeleteShader(fs);
    GLint linked = GL_FALSE;
    glGetProgramiv(blitProgram, GL_LINK_STATUS, &linked);
    if (linked != GL_TRUE) {
        char log[512];
        glGetProgramInfoLog(blitProgram, sizeof(log), nullptr, log);
        ALOGE("blit link failed: %s", log);
        glDeleteProgram(blitProgram);
        blitProgram = 0;
        return false;
    }
    ALOGI("blit shader ready");
    return true;
}

static void loadPreset(unsigned int index, bool hardCut) {
    if (!handle || index >= presetFiles.size()) return;
    std::string path = presetsDir + "/" + presetFiles[index];
    // transition time is 0 (soft_cut_duration=0): smooth flag is a no-op,
    // every change is a hard cut by design.
    lastFailedFile.clear();
    lastFailedMessage.clear();
    projectm_load_preset_file(handle, path.c_str(), !hardCut);
    std::string name = presetFiles[index];
    if (lastFailedFile == path) {
        ALOGW("preset #%u %s REJECTED by engine: %s",
              index, name.c_str(), lastFailedMessage.c_str());
    } else {
        ALOGD("preset -> #%u %s", index, name.c_str());
    }
}

extern "C" JNIEXPORT jint JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_create(
        JNIEnv *env, jobject, jint width, jint height, jstring jpresetsDir) {
    std::lock_guard<std::mutex> lock(engineMutex);
    const char *dir = env->GetStringUTFChars(jpresetsDir, nullptr);
    presetsDir = dir;
    env->ReleaseStringUTFChars(jpresetsDir, dir);

    presetFiles.clear();
    DIR *d = opendir(presetsDir.c_str());
    if (d) {
        struct dirent *ent;
        while ((ent = readdir(d)) != nullptr) {
            std::string name = ent->d_name;
            if (name.size() > 5 && name.compare(name.size() - 5, 5, ".milk") == 0) {
                presetFiles.push_back(name);
            }
        }
        closedir(d);
    }
    std::sort(presetFiles.begin(), presetFiles.end());
    ALOGI("scanned %zu presets in %s", presetFiles.size(), presetsDir.c_str());

    if (handle) {
        projectm_destroy(handle);
        handle = nullptr;
    }

    handle = projectm_create();
    if (!handle) {
        ALOGE("projectm_create failed");
        return 0;
    }
    projectm_set_mesh_size(handle, 24, 18);   // MilkDrop-classic mesh, low CPU for audio
    projectm_set_aspect_correction(handle, true);
    // Engine must never switch presets on its own; app settings drive it.
    projectm_set_preset_locked(handle, true);
    // Keep single-preset rendering: smooth blend doubles CPU cost per frame.
    // Transition time forced to 0: all preset changes are hard cuts.
    projectm_set_soft_cut_duration(handle, 0.0);
    projectm_set_preset_duration(handle, 3600.0);
    projectm_set_hard_cut_duration(handle, 0.0);
    // Surface load failures instead of swallowing them (diagnoses black screens).
    projectm_set_preset_switch_failed_event_callback(handle, onPresetFailed, nullptr);
    // Internal window small (see kInternalW/H) so GPU + CPU stay cheap;
    // audio/crossfade playback must never degrade because of the visualizer.
    surfaceWidth = width > 0 ? width : 1280;
    surfaceHeight = height > 0 ? height : 720;
    projectm_set_window_size(handle, kInternalW, kInternalH);
    // Load SOMETHING that works: a single random pick may be a broken preset
    // (shader/parse failure -> black screen), so retry with different random
    // presets until one loads clean (bounded: never stall surface creation).
    if (!presetFiles.empty()) {
        for (int attempt = 0; attempt < 10; attempt++) {
            unsigned int idx = (unsigned int) (rand() % (int) presetFiles.size());
            loadPreset(idx, true);
            std::string path = presetsDir + "/" + presetFiles[idx];
            if (lastFailedFile != path) break;
        }
    }
    ALOGI("created ok, presets=%zu", presetFiles.size());
    return (jint) presetFiles.size();
}

extern "C" JNIEXPORT void JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_destroy(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(engineMutex);
    if (handle) {
        projectm_destroy(handle);
        handle = nullptr;
    }
    presetFiles.clear();
}

extern "C" JNIEXPORT void JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_resize(JNIEnv *, jobject, jint width, jint height) {
    if (handle && width > 0 && height > 0) {
        surfaceWidth = width;
        surfaceHeight = height;
        projectm_set_window_size(handle, kInternalW, kInternalH);
        ensureRenderBuffers(width, height);
    }
}

static void blitOutputTexture() {
    unsigned int outTex = projectm_output_texture(handle);
    if (!outTex) {
        // Throttled: tells black-screen reports apart from dead-GL-state.
        // (Preset renders black by content vs no output texture at all.)
        static int zeroCount = 0;
        static long lastLogMs = 0;
        zeroCount++;
        long now = 0; // filled below via uptime
        struct timespec ts;
        clock_gettime(CLOCK_MONOTONIC, &ts);
        now = ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
        if (now - lastLogMs > 2000) {
            ALOGW("output texture 0 x%d in last 2s (no frame to blit)", zeroCount);
            lastLogMs = now;
            zeroCount = 0;
        }
        return;
    }
    (void) ensureRenderBuffers(surfaceWidth, surfaceHeight);
    // projectM leaves GL state dirty between frames; reset everything the
    // fullscreen blit needs off (depth test otherwise rejects the quad).
    glDisable(GL_DEPTH_TEST);
    glDepthMask(GL_FALSE);
    glDisable(GL_BLEND);
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_CULL_FACE);
    glDisable(GL_STENCIL_TEST);
    glDisable(GL_DITHER);
    glClearColor(0.f, 0.f, 0.f, 1.f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    // projectM resets the viewport to its internal size every frame;
    // the blit must cover the full window surface.
    glViewport(0, 0, surfaceWidth, surfaceHeight);
    glUseProgram(blitProgram);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, outTex);
    GLint texLoc = glGetUniformLocation(blitProgram, "uTex");
    glUniform1i(texLoc, 0);
    glEnableVertexAttribArray(0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 16, kQuadVerts);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 16, kQuadVerts + 2);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    glDisableVertexAttribArray(0);
    glDisableVertexAttribArray(1);


    glBindTexture(GL_TEXTURE_2D, 0);
    glUseProgram(0);
}

extern "C" JNIEXPORT void JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_renderFrame(JNIEnv *, jobject) {
    if (!handle) return;
    // projectM updates + composites its output texture at internal res,
    // then one GPU blit stretches to the full TV surface.
    projectm_opengl_render_frame(handle);
    blitOutputTexture();
}

// Cheap pass: no projectM update; just re-blit the last output texture.
extern "C" JNIEXPORT void JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_blitOnly(JNIEnv *, jobject) {
    blitOutputTexture();
}

extern "C" JNIEXPORT void JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_addPcmFloat(
        JNIEnv *env, jobject, jfloatArray pcmData, jint nsamples) {
    if (!handle || nsamples <= 0) return;
    jfloat *data = env->GetFloatArrayElements(pcmData, nullptr);
    if (data) {
        projectm_pcm_add_float(handle, data, (unsigned int) nsamples, PROJECTM_MONO);
        env->ReleaseFloatArrayElements(pcmData, data, JNI_ABORT);
    }
}

extern "C" JNIEXPORT jint JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_presetCount(JNIEnv *, jobject) {
    return (jint) presetFiles.size();
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_presetNameAt(JNIEnv *env, jobject, jint index) {
    if (index < 0 || (unsigned int) index >= presetFiles.size()) return env->NewStringUTF("");
    std::string n = presetFiles[index];
    return env->NewStringUTF(n.substr(0, n.size() - 5).c_str());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_selectPreset(JNIEnv *, jobject, jint index, jboolean hardCut) {
    std::lock_guard<std::mutex> lock(engineMutex);
    if (!handle || index < 0 || (unsigned int) index >= presetFiles.size()) return JNI_FALSE;
    loadPreset((unsigned int) index, hardCut == JNI_TRUE);
    std::string path = presetsDir + "/" + presetFiles[(unsigned int) index];
    if (lastFailedFile != path) return JNI_TRUE;
    // Broken preset: engine keeps showing the previous one, which reads as
    // "selection does nothing". Walk forward (bounded) to the nearest working
    // preset so every selection lands on fresh visuals.
    for (unsigned int step = 1; step < 20 && step < presetFiles.size(); step++) {
        unsigned int next = ((unsigned int) index + step) % presetFiles.size();
        loadPreset(next, hardCut == JNI_TRUE);
        std::string nextPath = presetsDir + "/" + presetFiles[next];
        if (lastFailedFile != nextPath) {
            ALOGI("select #%d broken, auto-skipped to #%u %s",
                  (int) index, next, presetFiles[next].c_str());
            return JNI_TRUE;
        }
    }
    return JNI_FALSE;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_randomPreset(JNIEnv *, jobject, jboolean hardCut) {
    std::lock_guard<std::mutex> lock(engineMutex);
    if (!handle || presetFiles.empty()) return -1;
    int idx = (int) (((unsigned int) rand()) % presetFiles.size());
    loadPreset((unsigned int) idx, hardCut == JNI_TRUE);
    return idx;
}

extern "C" JNIEXPORT void JNICALL
Java_com_castboxtv_app_viz_ProjectMJNI_setPresetLocked(JNIEnv *, jobject, jboolean locked) {
    if (handle) {
        projectm_set_preset_locked(handle, locked == JNI_TRUE);
    }
}
