// CastBox TV simple audio visualiser engine — core (compiles to WASM, ported to Android JNI later).
//
// Responsibilities (deliberately backend-agnostic):
//   * audio analysis  : window -> FFT -> log bands -> smoothing/peaks/beat
//   * scene layout    : preset = ordered list of components (bars, line, text, image, ...)
//   * variable binding: resolves {title} {artist} {clock} ... into concrete strings
//   * frame emission  : writes a portable draw-command list (flat float32 records)
//
// A backend only has to interpret Op codes (JS Canvas2D now, android.graphics.Canvas later).
// The engine never draws anything itself, so the exact same preset renders everywhere.
#pragma once

#include <cstdint>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define VZE_API extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define VZE_API extern "C" __attribute__((visibility("default")))
#endif

namespace vze {

// ---------------------------------------------------------------------------
// Component types. A preset is just an ordered list of these.
// ---------------------------------------------------------------------------
enum CompType : int {
    CT_BACKGROUND = 0,  // solid / gradient / image backdrop
    CT_SPECTRUM   = 1,  // spectrum bars (optionally with falling peaks)
    CT_LINE       = 2,  // waveform / spectrum curve line
    CT_TEXT       = 3,  // bound text ({title}, {artist}, {clock}, ...)
    CT_IMAGE      = 4,  // cover art or arbitrary image
    CT_SHAPE      = 5,  // rect / circle / divider
    CT_METER      = 6,  // level bar, progress bar or circular meter
    CT_BEAT       = 7,  // beat-reactive pulse ring (outline only)
    CT_BEAT_GLOW  = 8,  // filled glowing orb that flares on the beat
    CT_COVER      = 9,  // cover art + radial spectrum ring + glow + beat pulse
    CT_ORB        = 10, // cover art ringed by glow spectrum lines + beat pulse
    CT_PROGRESS   = 11, // song progress bar bound to positionSec/durationSec
    CT_RADIAL_LINE = 12, // circular waveform/spectrum line with glow
    CT_PARTICLES  = 13, // embers / snow / dust / stars / beat sparks
    CT_DOT_MATRIX = 14, // LED dot-grid equalizer
    CT_RAYS       = 15, // sunburst spokes driven by the spectrum
    CT_TERRAIN    = 16, // 3D spectrum mountains (orbit camera over history rows)
    CT_COUNT      = 17
};

enum Align : int { AL_LEFT = 0, AL_CENTER = 1, AL_RIGHT = 2 };
enum VAlign : int { VA_TOP = 0, VA_MIDDLE = 1, VA_BOTTOM = 2 };
enum Fit : int { FIT_CONTAIN = 0, FIT_COVER = 1, FIT_STRETCH = 2 };
enum BarAnchor : int { BA_BOTTOM = 0, BA_CENTER = 1, BA_TOP = 2 };
enum AudioSource : int { AS_RMS = 0, AS_PEAK = 1, AS_BASS = 2, AS_MID = 3, AS_TREBLE = 4, AS_BEAT = 5 };

// ---------------------------------------------------------------------------
// Draw opcodes. Each record is CMD_STRIDE float32 values.
//
//   [0]  op
//   [1]  x        [2] y   [3] w   [4] h        (pixels, already resolved)
//   [5]  r        [6] g   [7] b   [8] a        (primary colour, 0..1)
//   [9]  r2       [10] g2 [11] b2 [12] a2      (secondary colour, gradients)
//   [13] p0       [14] p1 [15] p2 [16] p3      (opcode specific floats)
//   [17] strId    (stable string id for the measure cache; -1 = none)
//   [18] strOff   [19] strLen                  (per-frame string pool slice)
//   [20] imgId    (image registry id, -1 = none)
//   [21] p4       [22] p5                      (extra floats)
//   [23] reserved
// ---------------------------------------------------------------------------
enum CmdField : int {
    C_OP = 0,
    C_X = 1, C_Y = 2, C_W = 3, C_H = 4,
    C_R = 5, C_G = 6, C_B = 7, C_A = 8,
    C_R2 = 9, C_G2 = 10, C_B2 = 11, C_A2 = 12,
    C_P0 = 13, C_P1 = 14, C_P2 = 15, C_P3 = 16,
    C_STRID = 17, C_STROFF = 18, C_STRLEN = 19, C_IMG = 20,
    C_P4 = 21, C_P5 = 22,
    C_ROLE = 23,        // opcode-specific role (1 = shadow pass for OP_TEXT)
    CMD_STRIDE = 24
};

enum Op : int {
    OP_CLEAR         = 0,  // fills the whole frame with rgba
    OP_RECT          = 1,  // p0 = corner radius px, p1 = stroke width (0 = filled)
    OP_GRADIENT_RECT = 2,  // p0 = angle deg, p1 = corner radius px
    OP_LINE          = 3,  // x,y -> w,h ; p0 = thickness, p1 = glow
    OP_TEXT          = 4,  // p0 = fontSize px, p1 = align, p2 = valign, p3 = weight, p4 = spacing, p5 = blur; R2/G2 = font family pool offset/len
    OP_IMAGE         = 5,  // p0 = fit, p1 = corner radius, p2 = tint amount, p3 = blur px, role = circle mask
    OP_CLIP_PUSH     = 6,  // clip x,y,w,h ; p0 = corner radius
    OP_CLIP_POP      = 7,
    OP_CIRCLE        = 8,  // x,y,w,h bounding box ; p0 = stroke width
    OP_GRADIENT_LINE = 9,  // stroked point-list polyline (P0 = count, P1 = point offset, P2 = width, P3 = gradient angle)
    OP_ARC           = 10, // p0 = start deg, p1 = sweep deg, p2 = thickness, p3 = caps
    OP_POLYGON       = 11, // p0 = point count, p1 = offset into point pool, p2 = stroke
    OP_RADIAL_GLOW   = 12, // soft orb: rgba -> transparent from centre to edge
    OP_COUNT         = 13
};

}  // namespace vze

// ---------------------------------------------------------------------------
// Public C ABI used by the JS glue (and by JNI on Android).
// ---------------------------------------------------------------------------

// --- introspection ---------------------------------------------------------
VZE_API int   vze_cmd_stride();          // floats per draw command
VZE_API int   vze_band_count();          // number of spectrum bands
VZE_API int   vze_audio_window();        // samples the host feeds per commit
VZE_API int   vze_type_id(const char* name, int len);
VZE_API int   vze_prop_id(const char* name, int len);
VZE_API int   vze_op_id(const char* name, int len);
VZE_API int   vze_type_count();
VZE_API const char* vze_type_name(int type);
VZE_API const char* vze_version();
VZE_API int   vze_version_code();

// --- lifecycle ------------------------------------------------------------
VZE_API void  vze_reset();                              // clear scene + state
VZE_API void  vze_set_surface(int w, int h);            // output size in px
VZE_API void  vze_set_audio_rate(int sampleRate);

// --- audio ----------------------------------------------------------------
// Returns a writable pointer to the engine's input buffer (vze_audio_window()
// floats). Host fills it with mono time-domain samples in -1..1, then calls
// vze_audio_commit(). Fewer samples are allowed (rest is zero padded).
VZE_API float* vze_audio_buffer();
VZE_API void   vze_audio_commit(int samples);
VZE_API float  vze_level(int source);                   // AudioSource enum -> 0..1
VZE_API float  vze_band(int index);                     // 0..1
VZE_API float  vze_beat_phase();                        // 0..1 phase of detected tempo

// --- variables (what the engine hands to presets) -------------------------
// Host publishes named strings; {name} tokens inside text patterns are replaced.
VZE_API void  vze_var_set(const char* name, int nameLen, const char* value, int valueLen);
VZE_API void  vze_var_set_number(const char* name, int nameLen, float value);
VZE_API const char* vze_var_get(const char* name, int nameLen);

// --- scene (preset) -------------------------------------------------------
VZE_API void  vze_scene_clear();
VZE_API int   vze_scene_add(int typeId);                 // returns component index
VZE_API void  vze_scene_remove(int index);
VZE_API void  vze_scene_move(int index, int to);
VZE_API void  vze_scene_set_num(int index, int propId, float value);
VZE_API float vze_scene_get_num(int index, int propId);
VZE_API void  vze_scene_set_str(int index, int propId, const char* value, int len);
VZE_API int   vze_scene_count();
VZE_API int   vze_scene_type(int index);

// --- images ---------------------------------------------------------------
// The backend owns the pixels (ImageBitmap on web, Bitmap on Android); the
// engine only needs the natural size to lay the image out.
//
// The host points the engine at the current track's artwork with
// vze_cover_set(). Any component whose `image` prop is the token "{cover}"
// then draws that image — so presets can use the song cover without knowing an
// image id, and it follows whatever track is playing.
VZE_API void  vze_cover_set(int imgId);
VZE_API int   vze_cover_get();
VZE_API void  vze_image_set(int id, float naturalW, float naturalH);
VZE_API void  vze_image_clear();

// --- text measurement feedback -------------------------------------------
// The backend measures the string it just drew and reports the width back so
// marquee / auto-fit converge (takes effect on the next frame).
VZE_API void  vze_measure_put(int strId, float width);
VZE_API float vze_measure_get(int strId);

// --- frame ----------------------------------------------------------------
VZE_API void     vze_frame(float dtMs);
VZE_API int      vze_cmd_count();
VZE_API float*   vze_cmd_data();
VZE_API int      vze_cmd_capacity();
VZE_API int      vze_point_count();
VZE_API float*   vze_point_data();
VZE_API const char* vze_pool_data();     // per-frame resolved string pool (utf8)
VZE_API int      vze_pool_len();
VZE_API int      vze_pool_capacity();
