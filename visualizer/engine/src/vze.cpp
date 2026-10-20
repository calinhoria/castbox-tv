// Simple audio visualiser engine — implementation.
// See vze.h for the contract. No rendering here: only analysis, layout and a
// portable draw-command stream.
#include "vze.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace vze {
namespace {

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const int   kFftSize   = 2048;
const int   kFftBins   = kFftSize / 2;
const int   kBands     = 64;
// Spectral tilt is referenced here so the midrange stays put and only the
// extremes move (see bandTilt()).
const float kTiltRefHz = 1000.f;
const int   kMaxCmds   = 20000;
const int   kMaxPoints = 8192;
const int   kPoolCap   = 262144;
const float kPi        = 3.14159265358979323846f;

// ---------------------------------------------------------------------------
// Prop registry — a prop is addressed by name so the JSON preset format and
// the C++ side can never drift apart (JS resolves names once at load time).
// ---------------------------------------------------------------------------
const char* kPropNames[] = {
    // geometry
    "x", "y", "w", "h", "opacity", "rotation", "anchorX", "anchorY",
    // colour / paint
    "color", "color2", "color3", "gradient", "gradientAngle", "gradientMode",
    "brightness", "saturation", "glow",
    // background
    "mode", "blur", "dim", "image", "scrollX", "scrollY", "zoom",
    // spectrum bars
    "bars", "gap", "barWidth", "roundness", "mirror", "centered",
    "peaks", "peakColor", "peakHeight", "peakFall", "peakHold",
    "smoothing", "decay", "minHeight", "maxHeight", "bandStart", "bandEnd",
    "logScale", "gain", "baseline", "peakWidth", "peakDelay", "peakGap",
    // line / waveform
    "strokeWidth", "fill", "fillColor", "fillOpacity", "lineMode",
    "tension", "linePoints", "snap",
    // text
    "pattern", "size", "weight", "italic", "align", "valign", "shadow",
    "shadowColor", "shadowBlur", "shadowOffset", "letterSpacing", "uppercase",
    "marquee", "marqueeSpeed", "marqueeGap", "marqueePause", "maxWidth", "lineGap", "font",
    // image
    "fit", "tint", "tintColor", "cornerRadius", "circle", "flipX", "flipY",
    // shape
    "shape", "filled",
    // meter
    "source", "direction", "trackColor", "trackOpacity", "cap",
    // beat pulse / glow
    "pulseMin", "pulseMax", "thickness", "rings", "intensity", "haloSize",
    "haloOpacity", "coreSize", "follow", "bloom", "haloColor",
    // cover (cover art + radial spectrum ring)
    "radialBars", "ringRadius", "radialLength", "radialGap", "arcStart", "arcSpan",
    "radialGain", "radialSmoothing", "radialDecay", "radialPeaks", "radialPeakColor",
    "pulseAmount", "coverScale", "imageAspect", "centerX", "centerY", "imagePulse", "hidden",
    // particles
    "count", "speed", "sway", "gravity", "twinkle", "beatBoost",
    // particle + spectrum shapes and colors (shape reuses the shape prop)
    "sizeVar", "colorMode",
    // spectrum gradient modes + bar segments
    "segmentShape", "segments", "segmentGap",
    // glass-floor reflection
    "reflection",
    // orb ring options
    "angularSmooth", "paletteRings",
    // progress thumb
    "thumb", "thumbScale",
    // dotmatrix
    "cols", "rows", "cellShape", "dimColor", "dimOpacity", "quantize",
    // rays
    "innerRadius", "length", "taper", "spin", "spinBeat",
    // legacy ridge props (component removed; names kept registered)
    "layers", "roughness", "seed", "baseHeight", "heightGain", "scrollSpeed",
    "reactMap", "depthFade", "fillGradient", "stroke", "strokeColor",
    // spectral tilt
    "tilt",
    // terrain (3D spectrum mountains). Rows/bands are prefixed because `rows`
// already belongs to dotmatrix; the spec's names would have collided.
    "terrainRows", "terrainBands", "rowIntervalMs", "flow", "heightScale", "floorDb",
    "rowSmooth", "widthTaper", "pitch", "fov", "distance", "lookY", "pitchBass", "zoomBeat",
    "rotateMode", "yawStart", "yawSpeed", "swayRange", "swayPeriod", "yawBeat",
    "kickDecay", "rotateAxis", "roll", "avoidEdgeOn", "colorBy", "depthFade",
    "heightGlow", "occlude", "floorGrid", "floorColor", "floorOpacity",
    // legacy fire props (components removed; names kept registered)
    "tongues", "flicker", "heat", "embers", "emberSpeed", "emberSize",
    "mantleSize", "logColor", "hearthColor",
    "veins", "flowSpeed", "hotColor", "coolColor", "crust",
    "waxColor", "wick", "drips", "poolSize", "flameHeight",
    nullptr
};

int propIdOf(const char* name, int len) {
    if (!name) return -1;
    if (len < 0) len = (int)std::strlen(name);
    for (int i = 0; kPropNames[i]; ++i) {
        const char* p = kPropNames[i];
        if ((int)std::strlen(p) == len && std::memcmp(p, name, (size_t)len) == 0) return i;
    }
    return -1;
}

const char* kTypeNames[] = {
    "background", "spectrum", "line", "text", "image", "shape", "meter", "beat",
    "beat_glow", "cover", "orb", "progress", "radial_line", "particles",
    "dotmatrix", "rays", "terrain"
};

const char* kOpNames[] = {
    "clear", "rect", "gradientRect", "line", "text", "image", "clipPush",
    "clipPop", "circle", "gradientLine", "arc", "polygon", "radialGlow"
};

int typeIdOf(const char* name, int len) {
    if (!name) return -1;
    if (len < 0) len = (int)std::strlen(name);
    for (int i = 0; i < (int)CT_COUNT; ++i) {
        const char* p = kTypeNames[i];
        if ((int)std::strlen(p) == len && std::memcmp(p, name, (size_t)len) == 0) return i;
    }
    return -1;
}

int opIdOf(const char* name, int len) {
    if (!name) return -1;
    if (len < 0) len = (int)std::strlen(name);
    for (int i = 0; i < (int)OP_COUNT; ++i) {
        const char* p = kOpNames[i];
        if ((int)std::strlen(p) == len && std::memcmp(p, name, (size_t)len) == 0) return i;
    }
    return -1;
}

// Prop ids are resolved once and cached: name -> id.
struct PropIds {
    static const PropIds& get() {
        static PropIds inst;
        return inst;
    }
    int x, y, w, h, opacity, rotation, anchorX, anchorY;
    int color, color2, color3, gradient, gradientAngle, gradientMode, brightness, saturation, glow;
    int mode, blur, dim, image, scrollX, scrollY, zoom;
    int bars, gap, barWidth, roundness, mirror, centered, peaks, peakColor, peakHeight,
        peakFall, peakHold, peakDelay, peakGap, smoothing, decay, minHeight, maxHeight, bandStart, bandEnd,
        logScale, gain, baseline, peakWidth;
    int strokeWidth, fill, fillColor, fillOpacity, lineMode, tension, linePoints, snap;
    int pattern, size, weight, italic, align, valign, shadow, shadowColor, shadowBlur,
        shadowOffset, letterSpacing, uppercase, marquee, marqueeSpeed, marqueeGap, marqueePause, maxWidth, lineGap, font;
    int fit, tint, tintColor, cornerRadius, circle, flipX, flipY;
    int shape, filled;
    int source, direction, trackColor, trackOpacity, cap;
    int pulseMin, pulseMax, thickness, rings;
    int intensity, haloSize, haloOpacity, coreSize, follow, bloom, haloColor;
    int radialBars, ringRadius, radialLength, radialGap, arcStart, arcSpan,
        radialGain, radialSmoothing, radialDecay, radialPeaks, radialPeakColor,
        pulseAmount, coverScale, imageAspect, centerX, centerY, imagePulse, hidden;
    int count, speed, sway, gravity, twinkle, beatBoost;
    int sizeVar, colorMode;
    int segmentShape, segments, segmentGap;
    int reflection;
    int angularSmooth, paletteRings;
    int cols, rows, cellShape, dimColor, dimOpacity, quantize;
    int innerRadius, length, taper, spin, spinBeat;
    int roughness, seed, baseHeight, heightGain, scrollSpeed, layers;
    int reactMap, depthFade, fillGradient, stroke, strokeColor;
    int tilt;
    int terrainRows, terrainBands, rowIntervalMs, flow, heightScale, floorDb, rowSmooth, widthTaper;
    int pitch, fov, distance, lookY, pitchBass, zoomBeat;
    int rotateMode, yawStart, yawSpeed, swayRange, swayPeriod, yawBeat, kickDecay;
    int rotateAxis, roll, avoidEdgeOn, colorBy, heightGlow;
    int occlude, floorGrid, floorColor, floorOpacity;
    int tongues, flicker, heat, embers, emberSpeed, emberSize;
    int mantleSize, logColor, hearthColor;
    int veins, flowSpeed, hotColor, coolColor, crust;
    int waxColor, wick, drips, poolSize, flameHeight;
    int thumb, thumbScale;

   private:
    PropIds() {
        auto p = [](const char* n) { return propIdOf(n, -1); };
        x = p("x"); y = p("y"); w = p("w"); h = p("h");
        opacity = p("opacity"); rotation = p("rotation");
        anchorX = p("anchorX"); anchorY = p("anchorY");
        color = p("color"); color2 = p("color2"); color3 = p("color3");
        gradient = p("gradient"); gradientAngle = p("gradientAngle"); gradientMode = p("gradientMode");
        brightness = p("brightness"); saturation = p("saturation"); glow = p("glow");
        mode = p("mode"); blur = p("blur"); dim = p("dim"); image = p("image");
        scrollX = p("scrollX"); scrollY = p("scrollY"); zoom = p("zoom");
        bars = p("bars"); gap = p("gap"); barWidth = p("barWidth"); roundness = p("roundness");
        mirror = p("mirror"); centered = p("centered"); peaks = p("peaks");
        peakColor = p("peakColor"); peakHeight = p("peakHeight"); peakFall = p("peakFall");
        peakHold = p("peakHold"); peakDelay = p("peakDelay"); peakGap = p("peakGap");
        smoothing = p("smoothing"); decay = p("decay");
        minHeight = p("minHeight"); maxHeight = p("maxHeight");
        bandStart = p("bandStart"); bandEnd = p("bandEnd"); logScale = p("logScale");
        gain = p("gain"); baseline = p("baseline"); peakWidth = p("peakWidth");
        strokeWidth = p("strokeWidth"); fill = p("fill"); fillColor = p("fillColor");
        fillOpacity = p("fillOpacity"); lineMode = p("lineMode"); tension = p("tension");
        linePoints = p("linePoints"); snap = p("snap");
        pattern = p("pattern"); size = p("size"); weight = p("weight"); italic = p("italic");
        align = p("align"); valign = p("valign"); shadow = p("shadow");
        shadowColor = p("shadowColor"); shadowBlur = p("shadowBlur"); shadowOffset = p("shadowOffset");
        letterSpacing = p("letterSpacing"); uppercase = p("uppercase");
        marquee = p("marquee"); marqueeSpeed = p("marqueeSpeed");
        marqueeGap = p("marqueeGap"); marqueePause = p("marqueePause");
        maxWidth = p("maxWidth");
        lineGap = p("lineGap"); font = p("font");
        fit = p("fit"); tint = p("tint"); tintColor = p("tintColor"); cornerRadius = p("cornerRadius");
        circle = p("circle"); flipX = p("flipX"); flipY = p("flipY");
        shape = p("shape"); filled = p("filled");
        source = p("source"); direction = p("direction"); trackColor = p("trackColor");
        trackOpacity = p("trackOpacity"); cap = p("cap");
        pulseMin = p("pulseMin"); pulseMax = p("pulseMax"); thickness = p("thickness");
        rings = p("rings");
        intensity = p("intensity"); haloSize = p("haloSize"); haloOpacity = p("haloOpacity");
        coreSize = p("coreSize"); follow = p("follow"); bloom = p("bloom");
        haloColor = p("haloColor");
        radialBars = p("radialBars"); ringRadius = p("ringRadius");
        radialLength = p("radialLength"); radialGap = p("radialGap");
        arcStart = p("arcStart"); arcSpan = p("arcSpan");
        radialGain = p("radialGain"); radialSmoothing = p("radialSmoothing");
        radialDecay = p("radialDecay"); radialPeaks = p("radialPeaks");
        radialPeakColor = p("radialPeakColor");
        pulseAmount = p("pulseAmount"); coverScale = p("coverScale");
        imageAspect = p("imageAspect"); centerX = p("centerX"); centerY = p("centerY");
        imagePulse = p("imagePulse"); hidden = p("hidden");
        count = p("count"); speed = p("speed"); sway = p("sway");
        gravity = p("gravity"); twinkle = p("twinkle"); beatBoost = p("beatBoost");
        segmentShape = p("segmentShape"); segments = p("segments"); segmentGap = p("segmentGap");
        reflection = p("reflection");
        angularSmooth = p("angularSmooth"); paletteRings = p("paletteRings");
        thumb = p("thumb"); thumbScale = p("thumbScale");
        sizeVar = p("sizeVar"); colorMode = p("colorMode");
        cols = p("cols"); rows = p("rows"); cellShape = p("cellShape");
        dimColor = p("dimColor"); dimOpacity = p("dimOpacity"); quantize = p("quantize");
        innerRadius = p("innerRadius"); length = p("length"); taper = p("taper");
        spin = p("spin"); spinBeat = p("spinBeat");
        roughness = p("roughness"); seed = p("seed"); baseHeight = p("baseHeight");
        layers = p("layers");
        heightGain = p("heightGain"); scrollSpeed = p("scrollSpeed");
        reactMap = p("reactMap"); depthFade = p("depthFade");
        fillGradient = p("fillGradient"); stroke = p("stroke");
        strokeColor = p("strokeColor");
        tilt = p("tilt");
        terrainRows = p("terrainRows"); terrainBands = p("terrainBands");
        rowIntervalMs = p("rowIntervalMs");
        flow = p("flow"); heightScale = p("heightScale"); floorDb = p("floorDb");
        rowSmooth = p("rowSmooth"); widthTaper = p("widthTaper");
        pitch = p("pitch"); fov = p("fov"); distance = p("distance"); lookY = p("lookY");
        pitchBass = p("pitchBass"); zoomBeat = p("zoomBeat");
        rotateMode = p("rotateMode"); yawStart = p("yawStart"); yawSpeed = p("yawSpeed");
        swayRange = p("swayRange"); swayPeriod = p("swayPeriod"); yawBeat = p("yawBeat");
        kickDecay = p("kickDecay"); rotateAxis = p("rotateAxis"); roll = p("roll");
        avoidEdgeOn = p("avoidEdgeOn"); colorBy = p("colorBy");
        depthFade = p("depthFade"); heightGlow = p("heightGlow");
        occlude = p("occlude"); floorGrid = p("floorGrid");
        floorColor = p("floorColor"); floorOpacity = p("floorOpacity");
        tongues = p("tongues"); flicker = p("flicker"); heat = p("heat");
        embers = p("embers"); emberSpeed = p("emberSpeed"); emberSize = p("emberSize");
        mantleSize = p("mantleSize"); logColor = p("logColor"); hearthColor = p("hearthColor");
        veins = p("veins"); flowSpeed = p("flowSpeed"); hotColor = p("hotColor");
        coolColor = p("coolColor"); crust = p("crust");
        waxColor = p("waxColor"); wick = p("wick"); drips = p("drips");
        poolSize = p("poolSize"); flameHeight = p("flameHeight");
    }
};

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
struct Rgba {
    float r = 1, g = 1, b = 1, a = 1;
};

int hexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

Rgba parseColor(const std::string& s, Rgba fallback) {
    if (s.empty()) return fallback;
    if (s[0] == '#') {
        size_t n = s.size() - 1;
        auto d = [&](size_t i) { return hexDigit(s[1 + i]); };
        if (n >= 6) {
            int r0 = d(0), r1 = d(1), g0 = d(2), g1 = d(3), b0 = d(4), b1 = d(5);
            if (r0 < 0 || g0 < 0 || b0 < 0) return fallback;
            Rgba c;
            c.r = (float)(r0 * 16 + r1) / 255.f;
            c.g = (float)(g0 * 16 + g1) / 255.f;
            c.b = (float)(b0 * 16 + b1) / 255.f;
            c.a = 1.f;
            if (n >= 8) {
                int a0 = d(6), a1 = d(7);
                if (a0 >= 0 && a1 >= 0) c.a = (float)(a0 * 16 + a1) / 255.f;
            }
            return c;
        }
        if (n >= 3) {  // #rgb
            int r0 = d(0), g0 = d(1), b0 = d(2);
            if (r0 < 0 || g0 < 0 || b0 < 0) return fallback;
            Rgba c;
            c.r = (float)(r0 * 17) / 255.f;
            c.g = (float)(g0 * 17) / 255.f;
            c.b = (float)(b0 * 17) / 255.f;
            return c;
        }
        return fallback;
    }
    if (s.compare(0, 4, "rgba") == 0 || s.compare(0, 3, "rgb") == 0) {
        float v[4] = {0, 0, 0, 1};
        int got = 0;
        const char* p = s.c_str();
        while (*p && got < 4) {
            if ((*p >= '0' && *p <= '9') || *p == '.') {
                v[got++] = (float)std::atof(p);
                while (*p && ((*p >= '0' && *p <= '9') || *p == '.')) ++p;
            } else {
                ++p;
            }
        }
        Rgba c;
        c.r = v[0] / 255.f;
        c.g = v[1] / 255.f;
        c.b = v[2] / 255.f;
        c.a = got >= 4 ? v[3] : 1.f;
        return c;
    }
    // Named shortcuts used by the built-in themes.
    if (s == "white")  return Rgba{1, 1, 1, 1};
    if (s == "black")  return Rgba{0, 0, 0, 1};
    if (s == "transparent") return Rgba{0, 0, 0, 0};
    return fallback;
}

float lerpf(float a, float b, float t) { return a + (b - a) * t; }
Rgba mixRgba(const Rgba& a, const Rgba& b, float t) {
    t = std::max(0.f, std::min(1.f, t));
    return Rgba{lerpf(a.r, b.r, t), lerpf(a.g, b.g, t), lerpf(a.b, b.b, t), lerpf(a.a, b.a, t)};
}

// Deterministic 0..1 hash — stable per index, so random colors never flicker.
float hash01(float n) {
    const float x = std::sin(n * 127.1f) * 43758.5453f;
    return x - std::floor(x);
}

Rgba hsv(float h, float s, float v, float a) {
    h = std::fmod(h, 360.f);
    if (h < 0.f) h += 360.f;
    s = std::max(0.f, std::min(1.f, s));
    v = std::max(0.f, std::min(1.f, v));
    const float c = v * s;
    const float x = c * (1.f - std::fabs(std::fmod(h / 60.f, 2.f) - 1.f));
    const float m = v - c;
    float r = 0.f, g = 0.f, b = 0.f;
    if (h < 60.f) { r = c; g = x; }
    else if (h < 120.f) { r = x; g = c; }
    else if (h < 180.f) { g = c; b = x; }
    else if (h < 240.f) { g = x; b = c; }
    else if (h < 300.f) { r = x; b = c; }
    else { r = c; b = x; }
    return Rgba{r + m, g + m, b + m, a};
}

float rgbHue(const Rgba& c) {
    const float mx = std::max(c.r, std::max(c.g, c.b));
    const float mn = std::min(c.r, std::min(c.g, c.b));
    const float d = mx - mn;
    if (d <= 0.0001f) return 0.f;
    float h;
    if (mx == c.r) h = 60.f * std::fmod((c.g - c.b) / d, 6.f);
    else if (mx == c.g) h = 60.f * ((c.b - c.r) / d + 2.f);
    else h = 60.f * ((c.r - c.g) / d + 4.f);
    return h < 0.f ? h + 360.f : h;
}

float rgbSat(const Rgba& c) {
    const float mx = std::max(c.r, std::max(c.g, c.b));
    return mx <= 0.0001f ? 0.f : (mx - std::min(c.r, std::min(c.g, c.b))) / mx;
}

float rgbVal(const Rgba& c) {
    return std::max(c.r, std::max(c.g, c.b));
}

// ---------------------------------------------------------------------------
// Published variables + string interning + measurement cache
// ---------------------------------------------------------------------------
struct VarTable {
    std::map<std::string, std::string> text;
    std::map<std::string, float> number;

    void setText(const std::string& k, const std::string& v) { text[k] = v; }
    void setNumber(const std::string& k, float v) {
        number[k] = v;
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%.2f", (double)v);
        text[k] = buf;
    }
    float num(const std::string& k, float def) const {
        auto it = number.find(k);
        return it == number.end() ? def : it->second;
    }
    bool has(const std::string& k) const {
        return text.find(k) != text.end() || number.find(k) != number.end();
    }
    std::string get(const std::string& k) const {
        auto it = text.find(k);
        return it == text.end() ? std::string() : it->second;
    }
};

// Interns strings so every distinct resolved text keeps a stable id, which the
// backend uses as a key for its measurement cache.
struct Interner {
    std::vector<std::string> items;
    std::map<std::string, int> ids;

    int intern(const std::string& s) {
        auto it = ids.find(s);
        if (it != ids.end()) return it->second;
        int id = (int)items.size();
        items.push_back(s);
        ids[s] = id;
        return id;
    }
    const std::string& get(int id) const {
        static const std::string empty;
        if (id < 0 || id >= (int)items.size()) return empty;
        return items[id];
    }
};

// Replaces {name} tokens in a pattern with published variables.
std::string resolvePattern(const std::string& pattern, const VarTable& vars) {
    std::string out;
    out.reserve(pattern.size() + 16);
    size_t i = 0;
    while (i < pattern.size()) {
        char c = pattern[i];
        if (c == '{') {
            size_t close = pattern.find('}', i + 1);
            if (close != std::string::npos) {
                std::string key = pattern.substr(i + 1, close - i - 1);
                // trim
                size_t a = key.find_first_not_of(" \t");
                size_t b = key.find_last_not_of(" \t");
                if (a != std::string::npos) key = key.substr(a, b - a + 1); else key.clear();
                if (!key.empty() && (key[0] == '#')) key = key.substr(1);  // {#}` escape
                if (vars.has(key)) {
                    out += vars.get(key);
                    i = close + 1;
                    continue;
                }
            }
            out += c;
            ++i;
        } else {
            out += c;
            ++i;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Scene components
// ---------------------------------------------------------------------------
struct Component {
    int type = CT_SPECTRUM;
    std::unordered_map<int, float> nums;
    std::unordered_map<int, std::string> strs;

    std::vector<float> heat;   // smoothed bar values 0..1
    std::vector<float> pk;     // falling peak caps 0..1
    std::vector<float> ph;     // seconds each peak cap has been holding (still)
    std::vector<float> tsm;    // terrain: temporally smoothed history copy
    // terrain camera state. Kept in component state (not derived from
    // wall-clock) so pause/seek behave and output stays deterministic.
    float camT = 0.f, yaw = 0.f, yawVel = 0.f;
    float kick = 0.f, kickVel = 0.f, pitchCur = 0.f, distCur = 0.f;
    float prevBeat = 0.f;
    std::vector<float> wave;   // smoothed line points -1..1
    std::vector<float> parts;  // particles: x,y,vx,vy,age,life per particle (box-normalised)
    float marquee = 0.f;       // marquee scroll offset in px
    float pulse = 0.f;         // beat pulse envelope 0..1

    float num(int pid, float def) const {
        auto it = nums.find(pid);
        return it == nums.end() ? def : it->second;
    }
    bool flag(int pid, bool def) const { return num(pid, def ? 1.f : 0.f) >= 0.5f; }
    std::string strOr(int pid, const char* def) const {
        auto it = strs.find(pid);
        return it == strs.end() ? std::string(def) : it->second;
    }
};

// ---------------------------------------------------------------------------
// Iterative radix-2 FFT (real input, Hann window). Dependency free so the same
// code compiles for Android later.
// ---------------------------------------------------------------------------
struct Fft {
    int n = 0;
    std::vector<float> window, re, im, cosT, sinT;
    std::vector<int> rev;

    void init(int size) {
        n = size;
        window.resize(n);
        for (int i = 0; i < n; ++i) window[i] = 0.5f - 0.5f * std::cos(2 * kPi * i / (n - 1));
        re.assign(n, 0.f);
        im.assign(n, 0.f);
        rev.assign(n, 0);
        int bits = 0;
        while ((1 << bits) < n) ++bits;
        for (int i = 0; i < n; ++i) {
            int r = 0;
            for (int b = 0; b < bits; ++b)
                if (i & (1 << b)) r |= 1 << (bits - 1 - b);
            rev[i] = r;
        }
        cosT.resize(n / 2);
        sinT.resize(n / 2);
        for (int i = 0; i < n / 2; ++i) {
            cosT[i] = std::cos(2 * kPi * i / n);
            sinT[i] = std::sin(2 * kPi * i / n);
        }
    }

    void run(const float* src, float* mag) {
        for (int i = 0; i < n; ++i) { re[i] = src[i] * window[i]; im[i] = 0.f; }
        for (int i = 0; i < n; ++i) {
            int j = rev[i];
            if (j > i) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
        }
        for (int len = 2; len <= n; len <<= 1) {
            const int half = len / 2;
            const int step = n / len;
            for (int i = 0; i < n; i += len) {
                for (int j = 0; j < half; ++j) {
                    const float wr = cosT[j * step];
                    const float wi = -sinT[j * step];
                    const int a = i + j, b = a + half;
                    const float tr = re[b] * wr - im[b] * wi;
                    const float ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }
        for (int i = 0; i < n / 2; ++i) mag[i] = std::sqrt(re[i] * re[i] + im[i] * im[i]);
    }
};

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------
struct Engine {
    // surface + audio config
    int surfW = 1280, surfH = 720;
    int sampleRate = 44100;

    std::vector<float> inBuf;
    Fft fft;
    std::vector<float> mag;        // linear FFT magnitudes
    std::vector<float> bands;      // 0..1 log-spaced spectrum bands
    std::vector<float> prevBands;  // previous frame's bands (onset flux)
    std::vector<float> bandHz;     // centre frequency of each band
    std::vector<int> binStart, binEnd;

    // levels
    float rms = 0.f, peak = 0.f, bass = 0.f, mid = 0.f, treb = 0.f;
    float beatPulse = 0.f, beatPhase = 0.f, bpm = 120.f, bassAvg = 0.06f, fluxAvg = 0.3f;
    double timeMs = 0.0, lastBeatMs = -1e9;

    // scene + published data
    std::vector<Component> comps;
    VarTable vars;
    Interner interner;
    std::unordered_map<int, float> measures;
    std::unordered_map<int, std::pair<float, float>> images;
    int coverId = 1;   // image id that the "{cover}" token resolves to

    // per-frame output
    std::vector<float> cmds;
    std::vector<float> points;
    std::vector<char> pool;
    int poolLen = 0;

    uint32_t rng = 0x9E3779B9u;   // deterministic visuals, same run every time

    float frand() {
        rng ^= rng << 13;
        rng ^= rng >> 17;
        rng ^= rng << 5;
        return (float)(rng & 0xffffff) / (float)0x1000000;
    }

    // scratch used by the render passes (kept for allocation-free frames)
    std::vector<float> scratch;

    // ---- shared spectrum history (terrain today; waterfall/trail reuse it) --
    // A ring buffer of the last kHistRows spectrum frames, always kBands wide.
    // Components resample to their own `bands` on read, so two components with
    // different resolutions can share one buffer.
    // constexpr, not const: std::min/std::max take it by const reference, which
    // is an ODR-use. C++17 makes constexpr statics implicitly inline, so this
    // needs no out-of-class definition (the Android link enforces that).
    static constexpr int kHistRows = 128;
    std::vector<float> hist;
    int histHead = 0;
    int histFilled = 0;
    float histTimer = 0.f;
    float histInterval = 45.f;      // fastest interval any consumer asked for

    void initHistory() {
        hist.assign(kHistRows * kBands, 0.f);
        histHead = 0;
        histFilled = 0;
        histTimer = 0.f;
    }

    /** Pushes one raw spectrum row if the shortest requested interval elapsed. */
    void pushHistory(float dtMs, float intervalMs) {
        if (hist.empty()) initHistory();
        histInterval = std::max(5.f, intervalMs);
        histTimer += dtMs;
        if (histTimer < histInterval) return;
        // Never skip more than one row per frame: a long stall advances slowly
        // instead of teleporting the terrain forward.
        histTimer -= histInterval;
        if (histTimer > histInterval) histTimer = histInterval;
        float* row = &hist[(size_t)histHead * kBands];
        for (int i = 0; i < kBands; ++i) row[i] = bands[i];
        histHead = (histHead + 1) % kHistRows;
        if (histFilled < kHistRows) ++histFilled;
    }

    void init() {
        fft.init(kFftSize);
        inBuf.assign(kFftSize, 0.f);
        mag.assign(kFftBins, 0.f);
        bands.assign(kBands, 0.f);
        prevBands.assign(kBands, 0.f);
        bandHz.assign(kBands, 0.f);
        binStart.assign(kBands, 0);
        binEnd.assign(kBands, 1);
        recomputeBands();
        cmds.reserve(kMaxCmds * CMD_STRIDE);
        points.reserve(kMaxPoints * 2);
        pool.reserve(8192);
        publishDefaults();
    }

    void recomputeBands() {
        const float fLo = 32.f;
        const float fHi = std::min(16000.f, sampleRate * 0.45f);
        for (int i = 0; i < kBands; ++i) {
            const float t0 = (float)i / kBands;
            const float t1 = (float)(i + 1) / kBands;
            const float f0 = fLo * std::pow(fHi / fLo, t0);
            const float f1 = fLo * std::pow(fHi / fLo, t1);
            float c = std::sqrt(f0 * f1);
            bandHz[i] = c;
            int b0 = (int)(f0 * kFftSize / sampleRate);
            int b1 = (int)(f1 * kFftSize / sampleRate);
            binStart[i] = std::max(0, std::min(b0, kFftBins - 1));
            binEnd[i] = std::max(binStart[i] + 1, std::min(b1, kFftBins));
        }
    }

    // Variables a preset can reference out of the box (host overwrites most).
    void publishDefaults() {
        const char* zeros[] = {"title", "artist", "album", "clock", "date", "time",
                               "remaining", "controller", "position", "duration", "bpm", "station", nullptr};
        for (int i = 0; zeros[i]; ++i) if (!vars.has(zeros[i])) vars.setText(zeros[i], "");
    }

    // ---- audio analysis ---------------------------------------------------
    void analyze(float dtMs) {
        fft.run(inBuf.data(), mag.data());
        const float norm = 4.0f / (float)kFftSize;
        float flux = 0.f;
        for (int b = 0; b < kBands; ++b) {
            // RMS over the band's bins (catches broadband transients better
            // than a mean), then a mild high-shelf tilt: music slopes down
            // with frequency, so without this the leftmost bars always win.
            double sum2 = 0.0;
            int n = 0;
            for (int i = binStart[b]; i < binEnd[b] && i < kFftBins; ++i) {
                const float m = mag[i] * norm;
                sum2 += (double)m * m;
                ++n;
            }
            const float rmsBand = std::sqrt((float)(sum2 / std::max(1, n)));
            const float tilt = 0.75f + 0.5f * (float)b / (float)(kBands - 1);
            const float v = std::max(0.f, std::min(1.f, std::sqrt(std::max(0.f, rmsBand)) * 1.25f * tilt));
            const float d = v - prevBands[b];
            if (d > 0.f) flux += d;
            prevBands[b] = v;
            bands[b] = v;
        }
        double sq = 0.0;
        float pk = 0.f;
        for (int i = 0; i < kFftSize; ++i) {
            const float v = inBuf[i];
            sq += (double)v * v;
            if (std::fabs(v) > pk) pk = std::fabs(v);
        }
        rms = (float)std::sqrt(sq / kFftSize);
        peak = pk;
        auto bandAvg = [&](float f0, float f1) {
            float s = 0.f;
            int n = 0;
            for (int i = 0; i < kBands; ++i)
                if (bandHz[i] >= f0 && bandHz[i] < f1) { s += bands[i]; ++n; }
            return n ? s / n : 0.f;
        };
        bass = bandAvg(0.f, 250.f);
        mid = bandAvg(250.f, 2000.f);
        treb = bandAvg(2000.f, 20000.f);

        bassAvg = bassAvg * 0.985f + bass * 0.015f;
        fluxAvg = fluxAvg * 0.92f + flux * 0.08f;
        beatPulse *= std::exp(-dtMs / 170.f);
        const double since = timeMs - lastBeatMs;
        // A kick is a broadband onset: spectral flux spikes even on
        // dynamically flat masters where the plain bass threshold never fires.
        const bool onset = flux > std::max(0.3f, fluxAvg * 1.6f) && since > 220.0;
        if ((bass > bassAvg * 1.45f && bass > 0.20f && since > 220.0) || onset) {
            if (since < 2000.0) bpm = (float)std::max(60.0, std::min(200.0, 60000.0 / since));
            lastBeatMs = timeMs;
            beatPulse = 1.f;
            beatPhase = 0.f;
        }
        const float periodMs = 60000.f / std::max(40.f, bpm);
        beatPhase += dtMs / periodMs;
        if (beatPhase > 1.f) beatPhase -= std::floor(beatPhase);

        vars.setNumber("bpm", bpm);
        vars.setNumber("bass", bass);
        vars.setNumber("mid", mid);
        vars.setNumber("treble", treb);
        vars.setNumber("rms", rms);
        vars.setNumber("peak", peak);
    }

    // ---- frame output helpers --------------------------------------------
    float* pushCmd(int op) {
        if ((int)cmds.size() + CMD_STRIDE > kMaxCmds * CMD_STRIDE) return nullptr;
        const size_t base = cmds.size();
        cmds.resize(base + CMD_STRIDE, 0.f);
        float* c = &cmds[base];
        c[C_OP] = (float)op;
        c[C_STRID] = -1.f;
        c[C_IMG] = -1.f;
        c[C_A] = 1.f;
        c[C_A2] = 1.f;
        return c;
    }

    int pushPoint(float x, float y) {
        if ((int)points.size() + 2 > kMaxPoints * 2) return (int)points.size() / 2;
        const int idx = (int)points.size() / 2;
        points.push_back(x);
        points.push_back(y);
        return idx;
    }

    // Copies resolved text into the frame pool; returns the byte offset.
    int pushText(const std::string& s) {
        if (poolLen + (int)s.size() + 1 > kPoolCap) return 0;
        const int off = poolLen;
        if ((int)pool.size() < poolLen + (int)s.size() + 1) pool.resize(poolLen + (int)s.size() + 1);
        std::memcpy(pool.data() + poolLen, s.data(), s.size());
        poolLen += (int)s.size();
        return off;
    }

    void putText(float* c, int strId, const std::string& s) {
        c[C_STRID] = (float)strId;
        c[C_STROFF] = (float)pushText(s);
        c[C_STRLEN] = (float)s.size();
    }

    // Optional per-text font family: parked in the spare (R2,G2) colour slots
    // as pool offset + byte length. Empty = backend default font stack.
    void putFont(float* c, const std::string& family) {
        if (family.empty()) return;
        c[C_R2] = (float)pushText(family);
        c[C_G2] = (float)family.size();
    }

    /**
     * Resolves a colour prop. The value may be a literal (#rrggbb, rgb(), a
     * named shortcut) or a `{token}` referring to a published variable — that
     * is how presets bind their colours to the preset's palette roles
     * (`{primary}`, `{secondary}`, `{accent}`, `{bg}`, `{surface}`, `{text}`),
     * which the host publishes via vze_var_set().
     */
    Rgba colorOf(const Component& k, int pid, const char* def, float mul = 1.f) const {
        Rgba c = parseColor(resolvePattern(k.strOr(pid, def), vars), Rgba{1, 1, 1, 1});
        c.a *= mul;
        return c;
    }

    // Palette role color by index: bg, surface, primary, secondary, accent, text.
    Rgba roleColor(int idx, float alpha) const {
        static const char* roles[6] = {"{bg}", "{surface}", "{primary}", "{secondary}", "{accent}", "{text}"};
        idx = std::max(0, std::min(5, idx));
        Rgba c = parseColor(resolvePattern(roles[idx], vars), Rgba{1, 1, 1, 1});
        c.a *= alpha;
        return c;
    }

    /**
     * Spectral tilt in dB per octave, applied to a band value BEFORE `gain`.
     *
     * Music energy falls off with frequency (roughly pink, ~3 dB/oct), so a
     * plain linear band mapping leaves the treble half of every spectrum dead.
     * A positive tilt lifts the top end back up; a negative one rolls it off.
     *
     * The slope is referenced to kTiltRefHz so the midrange stays put and the
     * extremes move. Bands are logarithmic (32 Hz .. 16 kHz, ~9 octaves), so
     * at +3 dB/oct this is 0 dB at 1 kHz, +9 dB at 8 kHz and -12 dB at 125 Hz.
     * The multiplier is clamped so an extreme tilt cannot run away.
     */
    float bandTilt(int band, float dbPerOct) const {
        if (std::fabs(dbPerOct) < 0.001f) return 1.f;
        const float f = (band >= 0 && band < kBands) ? bandHz[band] : 1000.f;
        if (f <= 1.f) return 1.f;
        const float oct = std::log2(f / kTiltRefHz);
        const float lin = std::pow(10.f, dbPerOct * oct / 20.f);
        return std::max(0.02f, std::min(20.f, lin));
    }

    /** Band value with spectral tilt folded in, before the component's gain. */
    float tiltedBand(int band, float tiltDb) const {
        const float v = (band >= 0 && band < kBands) ? bands[band] : 0.f;
        return v * bandTilt(band, tiltDb);
    }

    /**
     * Color modes shared by particles (per particle) and spectrum (per bar).
     * The seed must be stable per item (index, not frame) so random colors
     * never flicker: 0 manual, 1 random vivid pair, 2 two palette roles,
     * 3 base + complement, 4 vivid roles (artwork under From-cover).
     */
    void colorPair(int cm, float seed, const Rgba& c1, const Rgba& c2, Rgba& A, Rgba& B) const {
        switch (cm) {
            case 1:
                A = hsv(hash01(seed) * 360.f, 0.85f, 1.f, 1.f);
                B = hsv(hash01(seed + 17.f) * 360.f, 0.85f, 1.f, 1.f);
                break;
            case 2:
                A = roleColor((int)(hash01(seed) * 6.f), 1.f);
                B = roleColor((int)(hash01(seed + 31.f) * 6.f), 1.f);
                break;
            case 3: {
                Rgba comp = hsv(rgbHue(c1) + 180.f, std::max(0.5f, rgbSat(c1)), std::max(0.4f, rgbVal(c1)), 1.f);
                if (hash01(seed + 7.f) < 0.5f) { A = c1; B = comp; }
                else { A = comp; B = c1; }
                break;
            }
            case 4:
                A = roleColor(2 + (int)(hash01(seed) * 3.f), 1.f);
                B = roleColor(2 + (int)(hash01(seed + 13.f) * 3.f), 1.f);
                break;
            default:
                A = c1; B = c2;
                return;   // manual keeps its own alphas
        }
        A.a = c1.a;
        B.a = c2.a;
    }

    /**
     * Resolves an `image` prop to an image id. A plain number is used as-is;
     * the token "{cover}" (or any string containing it) means "whatever artwork
     * the host registered for the current track".
     */
    int resolveImageId(const Component& k, int pid, const char* def = "0") const {
        const std::string raw = k.strOr(pid, def);
        if (raw.find("{cover}") != std::string::npos) return coverId;
        const int n = std::atoi(raw.c_str());
        return n;
    }
    /**
     * Center-image box for cover/orb/radial_line. `size` is the square side
     * derived from coverScale; imageAspect (w/h, default 1) widens or
     * narrows it while the height stays put, so 1.0 reproduces the old
     * square exactly. The surrounding spectrum ring stays circular.
     */
    void centerImageBox(const Component& k, float cx, float cy, float size,
                        float& x, float& y, float& w, float& h) const {
        const PropIds& P = PropIds::get();
        const float a = std::max(0.25f, std::min(4.f, k.num(P.imageAspect, 1.f)));
        w = size * a; h = size;
        x = cx - w * 0.5f; y = cy - h * 0.5f;
    }
    /**
     * Effect center for cover/orb/radial_line, as a fraction of the box
     * (0.5 = dead middle, exactly the old behavior). Rings, loops and glow
     * move together RELATIVE to the image, which stays glued to the box
     * middle. Orb's glass-floor mirror stays on the box bottom.
     */
    void effectCenter(const Component& k, float bx, float by, float bw, float bh,
                        float& cx, float& cy) const {
        const PropIds& P = PropIds::get();
        cx = bx + bw * std::max(0.f, std::min(1.f, k.num(P.centerX, 0.5f)));
        cy = by + bh * std::max(0.f, std::min(1.f, k.num(P.centerY, 0.5f)));
    }    void setColor(float* c, const Rgba& v) {
        c[C_R] = v.r; c[C_G] = v.g; c[C_B] = v.b; c[C_A] = v.a;
    }
    void setColor2(float* c, const Rgba& v) {
        c[C_R2] = v.r; c[C_G2] = v.g; c[C_B2] = v.b; c[C_A2] = v.a;
    }

    // ---- geometry ---------------------------------------------------------
    struct Box { float x, y, w, h; };

    Box boxOf(const Component& k) const {
        const PropIds& P = PropIds::get();
        return Box{k.num(P.x, 0.05f) * surfW, k.num(P.y, 0.05f) * surfH,
                   k.num(P.w, 0.90f) * surfW, k.num(P.h, 0.30f) * surfH};
    }
    float opacityOf(const Component& k) const {
        const PropIds& P = PropIds::get();
        return std::max(0.f, std::min(1.f, k.num(P.opacity, 1.f)));
    }
    Rgba lerpColorAt(const Component& k, float t) const {
        const PropIds& P = PropIds::get();
        return mixRgba(colorOf(k, P.color, "#ffffff"), colorOf(k, P.color2, "#4d7cff"), t);
    }
    float textWidth(int strId, const std::string& s, float fontSize) const {
        auto it = measures.find(strId);
        if (it != measures.end() && it->second > 0.f) return it->second;
        return (float)s.size() * fontSize * 0.55f;  // converges after one frame
    }

    void emitRect(float x, float y, float w, float h, const Rgba& c, float radius, float glow) {
        if (w <= 0.f || h <= 0.f) return;
        float* cmd = pushCmd(OP_RECT);
        if (!cmd) return;
        cmd[C_X] = x; cmd[C_Y] = y; cmd[C_W] = w; cmd[C_H] = h;
        cmd[C_P0] = radius; cmd[C_P1] = 0.f; cmd[C_P2] = glow;
        setColor(cmd, c);
    }

    void emitGradientRect(float x, float y, float w, float h, const Rgba& a, const Rgba& b,
                          float angle, float radius) {
        if (w <= 0.f || h <= 0.f) return;
        float* cmd = pushCmd(OP_GRADIENT_RECT);
        if (!cmd) return;
        cmd[C_X] = x; cmd[C_Y] = y; cmd[C_W] = w; cmd[C_H] = h;
        cmd[C_P0] = angle; cmd[C_P1] = radius;
        setColor(cmd, a);
        setColor2(cmd, b);
    }

    // ---- background -------------------------------------------------------
    void passBackground(const Component& k) {
        const PropIds& P = PropIds::get();
        const int mode = (int)k.num(P.mode, 0.f);
        const float op = opacityOf(k);
        // Beat zoom + nudge (image mode only): the image scales up with the
        // beat and dips slightly downward, easing back as the beat decays.
        // Default 0 = static full-surface image.
        const float energy = std::max(beatPulse, levelOf(AS_BASS));
        const float pulse = std::max(0.f, std::min(0.9f, k.num(P.pulseAmount, 0.f))) * energy;
        if (mode == 2) {
            const int imgId = resolveImageId(k, P.image, "0");
            if (imgId != 0) {
                const float z = 1.f + pulse;
                const float zw = (float)surfW * z, zh = (float)surfH * z;
                float* cmd = pushCmd(OP_IMAGE);
                if (cmd) {
                    cmd[C_X] = ((float)surfW - zw) * 0.5f;
                    cmd[C_Y] = ((float)surfH - zh) * 0.5f + pulse * (float)surfH * 0.03f;
                    cmd[C_W] = zw; cmd[C_H] = zh;
                    cmd[C_P0] = (float)(int)k.num(P.fit, (float)FIT_COVER);
                    cmd[C_P3] = k.num(P.blur, 0.f);
                    cmd[C_IMG] = (float)imgId;
                    cmd[C_A] = op;
                    setColor(cmd, colorOf(k, P.tintColor, "#000000"));
                }
            }
            const float dim = std::max(0.f, std::min(1.f, k.num(P.dim, 0.35f)));
            emitRect(0, 0, (float)surfW, (float)surfH, colorOf(k, P.color, "#000000", op * dim), 0.f, 0.f);
            return;
        }
        if (mode == 1 || k.flag(P.gradient, false)) {
            emitGradientRect(0, 0, (float)surfW, (float)surfH,
                             colorOf(k, P.color, "#101018", op), colorOf(k, P.color2, "#2b1c4a", op),
                             k.num(P.gradientAngle, 90.f), 0.f);
            return;
        }
        float* cmd = pushCmd(OP_CLEAR);
        if (cmd) setColor(cmd, colorOf(k, P.color, "#000000", op));
    }

    // ---- spectrum bars (with optional falling peak caps) -------------------
    void passSpectrum(Component& k, float dtMs) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;

        const int bars = std::max(1, std::min(256, (int)k.num(P.bars, 32.f)));
        if ((int)k.heat.size() != bars) {
            k.heat.assign(bars, 0.f);
            k.pk.assign(bars, 0.f);
            k.ph.assign(bars, 0.f);
        }

        const float gain = k.num(P.gain, 1.f);
        const float tiltDb = k.num(P.tilt, 0.f);
        const float attack = 1.f - std::max(0.f, std::min(0.99f, k.num(P.smoothing, 0.55f)));
        const float release = 1.f - std::max(0.f, std::min(0.999f, k.num(P.decay, 0.82f)));
        const float bStart = std::max(0.f, std::min(1.f, k.num(P.bandStart, 0.f)));
        const float bEnd = std::max(bStart + 0.001f, std::min(1.f, k.num(P.bandEnd, 1.f)));
        const bool logv = k.flag(P.logScale, true);
        const bool mirror = k.flag(P.mirror, false);
        const bool peaks = k.flag(P.peaks, false);
        const bool gradient = k.flag(P.gradient, false) || (int)k.num(P.gradientMode, 0.f) != 0;
        // 0 = stretch (each bar spans the full color range), 1 = reveal (the
        // ramp is fixed to the box and bars uncover it), 2 = palette (the
        // whole palette as box-fixed stops, revealed the same way).
        const int gradMode = std::max(0, std::min(2, (int)k.num(P.gradientMode, 0.f)));
        // Per-bar color mode: 0 manual, 1 random, 2 palette roles,
        // 3 complementary, 4 vivid (cover) roles.
        const int colorMode = std::max(0, std::min(4, (int)k.num(P.colorMode, 0.f)));
        // Segmented LED-style bars: 0 = solid, 1 = circles, 2 = squares,
        // 3 = half squares (rounded blocks), with gaps between segments.
        const int segShape = std::max(0, std::min(3, (int)k.num(P.segmentShape, 0.f)));
        const float segGap = std::max(0.f, std::min(0.8f, k.num(P.segmentGap, 0.2f)));
        const float roundness = std::max(0.f, std::min(1.f, k.num(P.roundness, 0.f)));
        const float gapFrac = std::max(0.f, std::min(0.9f, k.num(P.gap, 0.18f)));
        const float widthFrac = std::max(0.05f, std::min(1.f, k.num(P.barWidth, 1.f - gapFrac)));
        const float minH = std::max(0.f, k.num(P.minHeight, 0.01f)) * b.h;
        const float maxH = std::max(0.01f, k.num(P.maxHeight, 1.f)) * b.h;
        const float glow = std::max(0.f, k.num(P.glow, 0.f));
        const float peakWidth = std::max(1.f, k.num(P.peakWidth, 4.f));
        const float peakFall = std::max(0.f, k.num(P.peakFall, 1.1f));
        // Peak caps hold still once the bar drops below them, then fall.
        const float peakDelay = std::max(0.f, k.num(P.peakDelay, 0.f));
        // Keep the cap clear of the bar tip so it never hides inside the bar.
        const float peakGap = std::max(0.f, k.num(P.peakGap, 0.f));
        const int anchor = k.flag(P.centered, false) ? BA_CENTER : (int)k.num(P.baseline, BA_BOTTOM);
        // Glass-floor reflection mirrors bars below the baseline, fading
        // with depth. Only for bottom-anchored bars; center mode keeps its
        // symmetric block instead.
        const bool reflect = k.flag(P.reflection, false) && anchor == BA_BOTTOM;
        const float baseY = b.y + b.h;

        // Mirrored layouts draw `bars` slots but only sample half the spectrum.
        const int srcCount = mirror ? (bars + 1) / 2 : bars;
        for (int i = 0; i < bars; ++i) {
            const int si = mirror ? (i < srcCount ? i : bars - 1 - i) : i;
            const float t = srcCount <= 1 ? 0.f : (float)si / (srcCount - 1);
            const float tt = logv ? std::pow(t, 1.6f) : t;
            const int band = std::max(0, std::min(kBands - 1, (int)((bStart + (bEnd - bStart) * tt) * (kBands - 1) + 0.5f)));
            const float raw = std::max(0.f, std::min(1.f, tiltedBand(band, tiltDb) * gain));
            const float prev = k.heat[i];
            k.heat[i] = prev + (raw - prev) * (raw > prev ? attack : release);
        }

        const float slot = b.w / bars;
        const float barW = std::max(1.f, slot * widthFrac);
        const float radius = barW * 0.5f * roundness;
        const float op = opacityOf(k);
        const Rgba c1 = colorOf(k, P.color, "#00e5ff", op);
        const Rgba c2 = colorOf(k, P.color2, "#ff2d95", op);
        const Rgba pc = colorOf(k, P.peakColor, "#ffffff", op);

        // Palette ramp stops (bottom -> top) for gradient mode 2.
        Rgba palStops[6];
        if (gradMode == 2) {
            const char* roles[6] = {"{bg}", "{surface}", "{primary}", "{secondary}", "{accent}", "{text}"};
            for (int s = 0; s < 6; ++s) {
                palStops[s] = parseColor(resolvePattern(roles[s], vars), Rgba{1, 1, 1, 1});
                palStops[s].a *= op;
            }
        }
        // Sample the box-fixed ramp at a 0..1 height fraction (0 = box
        // bottom). Mode 1 uses the given endpoint colors, mode 2 the palette.
        auto rampColor = [&](const Rgba& A, const Rgba& B, float f) -> Rgba {
            f = std::max(0.f, std::min(1.f, f));
            if (gradMode == 2) {
                const float x = f * 5.f;
                const int s = std::min(4, (int)x);
                return mixRgba(palStops[s], palStops[s + 1], x - (float)s);
            }
            return mixRgba(A, B, f);
        };
        // Height fraction of a y pixel for bottom-anchored layouts.
        auto fracBottom = [&](float y) {
            return std::max(0.f, std::min(1.f, ((b.y + b.h) - y) / std::max(1.f, b.h)));
        };

        // Real top edge of each drawn bar, in px. Segmented bars quantise to a
        // whole number of segments, so their top sits ABOVE the continuous
        // height — peak caps must be cleared of this, not of the raw height.
        std::vector<float> tipY(bars, 0.f);

        for (int i = 0; i < bars; ++i) {
            const float v = std::max(0.f, std::min(1.f, k.heat[i]));
            // Stable per-bar seed (mirrored index) so random colors never flicker.
            const int si2 = mirror ? (i < srcCount ? i : bars - 1 - i) : i;
            Rgba b1, b2;
            colorPair(colorMode, (float)si2 * 1.37f + 0.5f, c1, c2, b1, b2);
            const float h = minH + (maxH - minH) * v;
            const float cx = b.x + slot * (i + 0.5f);
            const float bx = cx - barW * 0.5f;
            float by = b.y + b.h - h;
            if (anchor == BA_CENTER) by = b.y + b.h * 0.5f - h * 0.5f;
            else if (anchor == BA_TOP) by = b.y;
            // Top-anchored bars grow DOWNWARD, so their outer (tip) edge is
            // the bottom one; everything else grows up.
            tipY[i] = (anchor == BA_TOP) ? by + h : by;

            if (segShape > 0) {
                // Auto-fit LED segments: the unit derives from the bar width
                // so squares are perfect squares and circles perfect dots;
                // the count is whatever fits in the box after the gap. The
                // gap is a fraction of the segment size (default 0.2).
                const float unit = std::max(1.f, std::min(barW, b.h / ((segShape == 3 ? 0.5f : 1.f) * (1.f + segGap))));
                const float shapeH = segShape == 3 ? unit * 0.5f : unit;
                const float segSlot = shapeH * (1.f + segGap);
                const int fit = std::max(1, (int)(b.h / segSlot));
                const int lit = v <= 0.001f ? 0 :
                    std::max(1, std::min(fit, (int)std::ceil(v * (float)fit)));
                // Center-anchored bars expand outward from the middle: the lit
                // block itself is centred in the box (slot counts alone can't
                // be symmetric when the grid under-fills the box).
                const float blockH = (float)lit * segSlot;
                const float yCursor = (anchor == BA_TOP) ? b.y
                    : (anchor == BA_CENTER) ? b.y + (b.h - blockH) * 0.5f
                    : b.y + b.h - blockH;
                if (lit > 0) tipY[i] = (anchor == BA_TOP) ? yCursor + blockH : yCursor;
                for (int j = 0; j < lit; ++j) {
                    const float syTop = yCursor + (float)j * segSlot;
                    // True box position for reveal coloring.
                    const float rowCy = syTop + segSlot * 0.5f;
                    const float fBot = ((b.y + b.h) - rowCy) / b.h;
                    const float ff = (anchor == BA_TOP) ? 1.f - fBot : fBot;
                    const Rgba sc = gradient ? rampColor(b1, b2, ff) : b1;
                    auto drawOne = [&](float top, const Rgba& col) -> bool {
                        if (segShape == 1) {
                            const float r = unit * 0.5f;
                            const float ccy = top + segSlot * 0.5f;
                            float* cmd = pushCmd(OP_CIRCLE);
                            if (!cmd) return false;
                            cmd[C_X] = cx - r; cmd[C_Y] = ccy - r;
                            cmd[C_W] = r * 2.f; cmd[C_H] = r * 2.f;
                            cmd[C_P0] = 0.f;
                            setColor(cmd, col);
                        } else {
                            // Squares and half squares are sharp by definition.
                            emitRect(bx, top + (segSlot - shapeH) * 0.5f, barW, shapeH, col, 0.f, 0.f);
                        }
                        return true;
                    };
                    if (!drawOne(syTop, sc)) break;
                    if (reflect) {
                        // Deeper originals cast fainter reflections.
                        const float depth = ((float)j + 0.5f) / (float)lit;
                        Rgba rc = sc;
                        rc.a *= 0.35f * (1.f - depth * 0.7f);
                        if (!drawOne(2.f * baseY - (syTop + segSlot), rc)) break;
                    }
                }
            } else if (gradient && gradMode == 0) {
                // gradientAngle convention: 0 = bottom->top (bars grow upward),
                // 180 = top->bottom.
                if (anchor == BA_TOP) emitGradientRect(bx, by, barW, h, b2, b1, 180.f, radius);
                else if (anchor == BA_BOTTOM) emitGradientRect(bx, by, barW, h, b1, b2, 0.f, radius);
                else {
                    const float half = h * 0.5f;
                    emitGradientRect(bx, by, barW, half, b2, b1, 180.f, radius);
                    emitGradientRect(bx, by + half, barW, half, b1, b2, 0.f, radius);
                }
            } else if (gradient) {
                // Reveal: the ramp is fixed to the box; the bar uncovers the
                // slice matching its own edges.
                if (anchor == BA_TOP) {
                    auto fracTop = [&](float y) {
                        return std::max(0.f, std::min(1.f, (y - b.y) / std::max(1.f, b.h)));
                    };
                    emitGradientRect(bx, by, barW, h, rampColor(b1, b2, fracTop(by)), rampColor(b1, b2, fracTop(by + h)), 180.f, radius);
                } else if (anchor == BA_BOTTOM) {
                    emitGradientRect(bx, by, barW, h, rampColor(b1, b2, fracBottom(by + h)), rampColor(b1, b2, fracBottom(by)), 0.f, radius);
                } else {
                    const float half = h * 0.5f;
                    emitGradientRect(bx, by, barW, half, rampColor(b1, b2, fracBottom(by + half)), rampColor(b1, b2, fracBottom(by)), 180.f, radius);
                    emitGradientRect(bx, by + half, barW, half, rampColor(b1, b2, fracBottom(by + h)), rampColor(b1, b2, fracBottom(by + half)), 0.f, radius);
                }
            } else {
                emitRect(bx, by, barW, h, b1, radius, glow);
            }

            if (reflect && h > 0.f) {
                // Solid bars mirror as one fading gradient: bar-bottom color
                // at the baseline dissolving to transparent at the tip.
                Rgba rb = gradient ? rampColor(b1, b2, 0.f) : b1;
                rb.a *= 0.35f;
                Rgba rt = rb;
                rt.a = 0.f;
                emitGradientRect(bx, baseY, barW, h, rb, rt, 180.f, radius);
            }
        }

        // Peak caps in their own pass, after every bar: a cap must never be
        // hidden behind (or hide) a bar, so it is drawn last and always sits
        // at least `peakGap` clear of its own bar tip.
        if (peaks) {
            // Ceiling for the caps. Segmented bars round up to a whole segment,
            // so their tallest lit block can exceed the continuous maxHeight —
            // clamping caps to maxHeight would bury them inside tall bars.
            float maxPk = maxH;
            if (segShape > 0) {
                const float unit = std::max(1.f, std::min(barW,
                    b.h / ((segShape == 3 ? 0.5f : 1.f) * (1.f + segGap))));
                const float shapeH = segShape == 3 ? unit * 0.5f : unit;
                const int fit = std::max(1, (int)(b.h / (shapeH * (1.f + segGap))));
                maxPk = std::max(maxH, (float)fit * shapeH * (1.f + segGap));
            }
            for (int i = 0; i < bars; ++i) {
                const float v = std::max(0.f, std::min(1.f, k.heat[i]));
                const float want = minH + (maxH - minH) * v;
                if (want > k.pk[i]) {
                    k.pk[i] = want;
                    k.ph[i] = 0.f;                    // climbed: no hold left
                } else {
                    // "Stop delay": sit still for peakDelay seconds after the
                    // bar drops below, only then start falling.
                    k.ph[i] += dtMs / 1000.f;
                    if (k.ph[i] >= peakDelay) {
                        k.pk[i] = std::max(0.f, k.pk[i] - peakFall * b.h * dtMs / 1000.f);
                    }
                }
                // Anchor-relative distance from the anchor edge to the bar's ACTUAL tip,
                // so segmented bars (which round up to a whole segment) clear.
                const float midY = b.y + b.h * 0.5f;
                const float tipH = (anchor == BA_CENTER) ? (midY - tipY[i])
                    : (anchor == BA_TOP) ? (tipY[i] - b.y)
                    : ((b.y + b.h) - tipY[i]);
                // Cap: its own peak, but never inside the drawn bar. peakGap is the
                // VISIBLE daylight between the cap's near edge and the bar tip,
                // so the cap's own thickness counts towards the offset.
                const float ph = std::min(std::max(k.pk[i], tipH + peakGap + peakWidth), maxPk);
                if (ph <= 0.f) continue;
                const float cx = b.x + slot * (i + 0.5f);
                const float bx = cx - barW * 0.5f;
                const float pyy = (anchor == BA_CENTER) ? midY - ph
                    : (anchor == BA_TOP) ? b.y + ph
                    : (b.y + b.h) - ph;
                emitRect(bx, pyy, barW, peakWidth, pc, peakWidth * 0.5f * roundness, glow);
            }
        }
    }

    // ---- line (waveform or spectrum curve) --------------------------------
    void passLine(Component& k, float /*dtMs*/) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const int pts = std::max(2, std::min(512, (int)k.num(P.linePoints, 128.f)));
        if ((int)k.wave.size() != pts) k.wave.assign(pts, 0.f);

        const int mode = (int)k.num(P.lineMode, 0.f);  // 0 waveform, 1 spectrum curve
        const float gain = k.num(P.gain, 1.f);
        const float tiltDb = k.num(P.tilt, 0.f);
        const float smooth = std::max(0.f, std::min(0.95f, k.num(P.smoothing, 0.45f)));
        const float stroke = std::max(0.5f, k.num(P.strokeWidth, 0.008f) * surfH);
        const bool fill = k.flag(P.fill, false);
        const bool gradient = k.flag(P.gradient, false);
        const float amp = b.h * 0.5f;

        for (int i = 0; i < pts; ++i) {
            float target;
            if (mode == 0) {
                target = inBuf[(int)((float)i / (pts - 1) * (kFftSize - 1))];
            } else {
                const int band = std::max(0, std::min(kBands - 1, (int)((float)i / (pts - 1) * (kBands - 1) + 0.5f)));
                target = tiltedBand(band, tiltDb) * gain;
            }
            k.wave[i] += (target - k.wave[i]) * (1.f - smooth);
        }

        const int base = (int)points.size() / 2;
        // Catmull-Rom upsampling (4x): the control points stay as the user
        // set them, but the emitted curve is smooth instead of jagged. Both
        // backends draw point lists as-is, so no protocol change is needed.
        const int UP = 4;
        const int out = (pts - 1) * UP + 1;
        // Spectrum curves render as a band mirrored about the vertical
        // centre (forward along the top, back along the bottom).
        const bool band = (mode == 1);
        const float cy = b.y + b.h * 0.5f;
        const int need = band ? out * 2 : out;
        if (base + need + 2 > kMaxPoints) return;
        if ((int)scratch.size() < out) scratch.assign(out, 0.f);
        auto sample = [&](int i) -> float {
            if (i < 0) i = 0;
            if (i >= pts) i = pts - 1;
            return k.wave[i];
        };
        float peak = 0.f;
        for (int j = 0; j < out; ++j) {
            const float fi = (float)j / UP;
            const int i = (int)fi;
            const float t = fi - i;
            const float p0 = sample(i - 1), p1 = sample(i), p2 = sample(i + 1), p3 = sample(i + 2);
            const float v = 0.5f * ((2.f * p1) + (-p0 + p2) * t +
                (2.f * p0 - 5.f * p1 + 4.f * p2 - p3) * t * t +
                (-p0 + 3.f * p1 - 3.f * p2 + p3) * t * t * t);
            scratch[j] = v;
            peak = std::max(peak, std::fabs(v));
        }
        // Silence gate: a flat signal would draw a phantom straight line, so
        // fade the whole line out below ~1% level instead.
        const float gate = std::max(0.f, std::min(1.f, (peak - 0.005f) / 0.03f));
        if (gate <= 0.001f) return;

        float firstX = 0.f, lastX = 0.f, baseY = 0.f;
        if (!band) {
            for (int j = 0; j < out; ++j) {
                const float x = b.x + b.w * (float)j / (out - 1);
                const float y = b.y + b.h * 0.5f - scratch[j] * amp;
                if (j == 0) { firstX = x; baseY = b.y + b.h * 0.5f; }
                lastX = x;
                pushPoint(x, y);
            }
        } else {
            // Spectrum curve: one line in the upper half, fill shades down to
            // the centre. The old mirrored band stroked its return edge too,
            // which read as a second line.
            const float half = b.h * 0.5f;
            for (int j = 0; j < out; ++j) {
                const float x = b.x + b.w * (float)j / (out - 1);
                pushPoint(x, cy - scratch[j] * half);
                if (j == 0) { firstX = x; baseY = cy; }
                lastX = x;
            }
        }
        const int nPts = out;

        if (fill) {
            pushPoint(lastX, baseY);
            pushPoint(firstX, baseY);
            const int fn = nPts + 2;
            float* f = pushCmd(OP_POLYGON);
            if (f) {
                f[C_P0] = (float)fn;
                f[C_P1] = (float)base;
                f[C_P2] = 0.f;
                const float fa = std::max(0.f, std::min(1.f, k.num(P.fillOpacity, 0.25f)));
                setColor(f, colorOf(k, P.fillColor, "#00e5ff", fa * opacityOf(k) * gate));
            }
        }

        // Glow on the line itself: stacked bloom passes (core + falloffs),
        // scaled by the glow prop. glow = 0 keeps the single crisp stroke so
        // existing presets look exactly as before.
        const float glowAmt = std::max(0.f, k.num(P.glow, 0.f));
        const int passes = glowAmt > 0.05f ? 3 : 1;
        const float widths[3] = {stroke, stroke * (1.f + glowAmt / 10.f), stroke * (1.f + glowAmt / 3.5f)};
        const float alphas[3] = {1.f, 0.35f, 0.15f};
        const float op = opacityOf(k);
        for (int pass = 0; pass < passes; ++pass) {
            float* c = pushCmd(gradient ? OP_GRADIENT_LINE : OP_POLYGON);
            if (!c) break;
            c[C_P0] = (float)nPts;
            c[C_P1] = (float)base;
            c[C_P2] = widths[pass];
            c[C_P3] = gradient ? k.num(P.gradientAngle, 90.f) : glowAmt;
            setColor(c, colorOf(k, P.color, "#00e5ff", op * alphas[pass] * gate));
            setColor2(c, colorOf(k, P.color2, "#4d7cff", op * alphas[pass] * gate));
        }
    }

    // ---- bound text ------------------------------------------------------
    void passText(Component& k, float dtMs) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        std::string text = resolvePattern(k.strOr(P.pattern, "{title}"), vars);
        if (k.flag(P.uppercase, false)) {
            for (size_t i = 0; i < text.size(); ++i)
                text[i] = (char)std::toupper((unsigned char)text[i]);
        }
        const int strId = interner.intern(text);
        const float fontSize = std::max(6.f, k.num(P.size, 0.06f) * surfH);
        const int align = (int)k.num(P.align, (float)AL_LEFT);
        const int valign = (int)k.num(P.valign, (float)VA_TOP);
        const float weight = k.num(P.weight, 0.f);
        const float spacing = k.num(P.letterSpacing, 0.f);
        const std::string fontName = k.strOr(P.font, "");

        float txBase = b.x;
        if (align == AL_CENTER) txBase = b.x + b.w * 0.5f;
        else if (align == AL_RIGHT) txBase = b.x + b.w;
        float ty = b.y;
        if (valign == VA_MIDDLE) ty = b.y + b.h * 0.5f;
        else if (valign == VA_BOTTOM) ty = b.y + b.h;

        // Marquee scrolls only when the resolved text is wider than its box.
        // Spotify-style cycle: hold the start for marqueePause seconds, scroll
        // through, leave a marqueeGap behind the tail, then wrap and hold
        // again. A second copy bridges the wrap so the tail never jumps.
        // (k.marquee stores cycle seconds, not pixels.)
        const float measured = textWidth(strId, text, fontSize);
        const bool scrolls = k.flag(P.marquee, false) && measured > b.w;
        float offsets[2] = {0.f, 0.f};
        int nOff = 1;
        if (scrolls) {
            const float gap = std::max(0.f, k.num(P.marqueeGap, 0.5f)) * b.w;
            const float pause = std::max(0.f, std::min(30.f, k.num(P.marqueePause, 5.f)));
            const float speed = std::max(1.f, k.num(P.marqueeSpeed, 40.f));
            const float total = measured + gap;
            const float cycle = pause + total / speed;
            k.marquee += dtMs / 1000.f;
            if (cycle > 0.001f && k.marquee > cycle) k.marquee = std::fmod(k.marquee, cycle);
            const float off = k.marquee < pause ? 0.f : std::min((k.marquee - pause) * speed, total);
            offsets[0] = off;
            if (off > total - b.w) { offsets[1] = off - total; nOff = 2; }
        }

        // Clip to the component box so scrolling text never escapes it.
        if (k.flag(P.marquee, false)) {
            float* cp = pushCmd(OP_CLIP_PUSH);
            if (cp) {
                cp[C_X] = b.x; cp[C_Y] = b.y; cp[C_W] = b.w; cp[C_H] = b.h;
                cp[C_P0] = 0.f;
            }
        }

        // One pass per visible copy (the second bridges the wrap gap).
        for (int o = 0; o < nOff; ++o) {
            const float tx = (scrolls ? b.x : txBase) - offsets[o];
            if (k.flag(P.shadow, true)) {
                const float soff = k.num(P.shadowOffset, 3.f);
                float* s = pushCmd(OP_TEXT);
                if (s) {
                    s[C_X] = tx + soff; s[C_Y] = ty + soff; s[C_W] = b.w;
                    s[C_P0] = fontSize; s[C_P1] = (float)align; s[C_P2] = (float)valign;
                    s[C_P3] = weight; s[C_P4] = spacing; s[C_P5] = k.num(P.shadowBlur, 8.f);
                    s[C_ROLE] = 1.f;  // soft-shadow pass
                    setColor(s, colorOf(k, P.shadowColor, "#000000", 0.72f * opacityOf(k)));
                    putText(s, strId, text);
                    putFont(s, fontName);
                }
            }

            float* c = pushCmd(OP_TEXT);
            if (c) {
                c[C_X] = tx; c[C_Y] = ty; c[C_W] = b.w;
                c[C_P0] = fontSize; c[C_P1] = (float)align; c[C_P2] = (float)valign;
                c[C_P3] = weight; c[C_P4] = spacing; c[C_P5] = k.num(P.glow, 0.f);
                setColor(c, colorOf(k, P.color, "#ffffff", opacityOf(k)));
                putText(c, strId, text);
                putFont(c, fontName);
            }
        }

        if (k.flag(P.marquee, false)) pushCmd(OP_CLIP_POP);
    }

    // ---- image (cover art, logos, background photos) ----------------------
    void passImage(const Component& k) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        const int imgId = resolveImageId(k, P.image, "0");
        if (imgId == 0) return;
        float* c = pushCmd(OP_IMAGE);
        if (!c) return;
        const float radius = k.num(P.cornerRadius, 0.f) * std::min(b.w, b.h) * 0.5f;
        c[C_X] = b.x; c[C_Y] = b.y; c[C_W] = b.w; c[C_H] = b.h;
        c[C_P0] = (float)(int)k.num(P.fit, (float)FIT_COVER);
        c[C_P1] = radius;
        c[C_P2] = k.num(P.tint, 0.f);
        c[C_P3] = std::max(0.f, k.num(P.blur, 0.f));
        c[C_ROLE] = k.flag(P.circle, false) ? 1.f : 0.f;
        c[C_P4] = k.flag(P.flipX, false) ? 1.f : 0.f;
        c[C_P5] = k.flag(P.flipY, false) ? 1.f : 0.f;
        c[C_IMG] = (float)imgId;
        c[C_A] = opacityOf(k) * colorOf(k, P.color, "#ffffff").a;
        setColor(c, colorOf(k, P.tintColor, "#ffffff"));
    }

    // ---- shape (panel, divider, disc for the cover) -----------------------
    void passShape(const Component& k) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        const int shape = (int)k.num(P.shape, 0.f);  // 0 rect, 1 circle, 2 divider
        const bool filled = k.flag(P.filled, true);
        const float sw = std::max(0.5f, k.num(P.strokeWidth, 0.006f) * surfH);
        const float radius = k.num(P.cornerRadius, 0.f) * std::min(b.w, b.h) * 0.5f;
        const Rgba c = colorOf(k, P.color, "#ffffff", opacityOf(k));

        if (shape == 1) {
            float* cmd = pushCmd(OP_CIRCLE);
            if (!cmd) return;
            cmd[C_X] = b.x; cmd[C_Y] = b.y; cmd[C_W] = b.w; cmd[C_H] = b.h;
            cmd[C_P0] = filled ? 0.f : sw;
            cmd[C_P3] = k.num(P.glow, 0.f);
            setColor(cmd, c);
            return;
        }
        if (shape == 2) {
            const float cy = b.y + b.h * 0.5f;
            float* cmd = pushCmd(OP_LINE);
            if (!cmd) return;
            cmd[C_X] = b.x; cmd[C_Y] = cy; cmd[C_W] = b.x + b.w; cmd[C_H] = cy;
            cmd[C_P0] = sw;
            setColor(cmd, c);
            return;
        }
        if (k.flag(P.gradient, false)) {
            Rgba g1 = c; Rgba g2 = colorOf(k, P.color2, "#000000", opacityOf(k));
            emitGradientRect(b.x, b.y, b.w, b.h, g1, g2,
                             k.num(P.gradientAngle, 90.f), radius);
            return;
        }
        float* cmd = pushCmd(OP_RECT);
        if (!cmd) return;
        cmd[C_X] = b.x; cmd[C_Y] = b.y; cmd[C_W] = b.w; cmd[C_H] = b.h;
        cmd[C_P0] = radius; cmd[C_P1] = filled ? 0.f : sw; cmd[C_P2] = k.num(P.glow, 0.f);
        setColor(cmd, c);
    }

    // ---- meter (level / progress / volume, linear or circular) ------------
    float levelOf(int src) const {
        switch (src) {
            case AS_PEAK: return std::min(1.f, peak);
            case AS_BASS: return std::min(1.f, bass);
            case AS_MID: return std::min(1.f, mid);
            case AS_TREBLE: return std::min(1.f, treb);
            case AS_BEAT: return std::min(1.f, beatPulse);
            default: return std::min(1.f, rms * 3.f);
        }
    }

    void passMeter(const Component& k) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        const float op = opacityOf(k);
        const float v = levelOf((int)k.num(P.source, (float)AS_RMS));
        const float radius = k.num(P.cornerRadius, 0.f) * std::min(b.w, b.h) * 0.5f;
        const int dir = (int)k.num(P.direction, 0.f);  // 0 L->R, 1 B->T, 2 ring

        if (dir == 2) {
            const float thick = std::max(1.f, k.num(P.thickness, 0.02f) * std::min(b.w, b.h));
            const float cx = b.x + b.w * 0.5f, cy = b.y + b.h * 0.5f;
            const float rx = b.w * 0.5f - thick * 0.5f, ry = b.h * 0.5f - thick * 0.5f;
            float* t = pushCmd(OP_ARC);
            if (t) {
                t[C_X] = cx; t[C_Y] = cy; t[C_W] = rx; t[C_H] = ry;
                t[C_P0] = -90.f; t[C_P1] = 360.f; t[C_P2] = thick; t[C_P3] = 1.f;
                setColor(t, colorOf(k, P.trackColor, "#ffffff", 0.15f * op));
            }
            float* a = pushCmd(OP_ARC);
            if (a) {
                a[C_X] = cx; a[C_Y] = cy; a[C_W] = rx; a[C_H] = ry;
                a[C_P0] = -90.f; a[C_P1] = 360.f * v; a[C_P2] = thick; a[C_P3] = 1.f;
                setColor(a, colorOf(k, P.color, "#00e5ff", op));
            }
            return;
        }

        const float trackA = std::max(0.f, std::min(1.f, k.num(P.trackOpacity, 0.18f))) * op;
        emitRect(b.x, b.y, b.w, b.h, colorOf(k, P.trackColor, "#ffffff", trackA), radius, 0.f);
        if (dir == 1) {
            const float fh = b.h * v;
            emitRect(b.x, b.y + b.h - fh, b.w, fh, colorOf(k, P.color, "#00e5ff", op), radius, k.num(P.glow, 0.f));
        } else {
            emitRect(b.x, b.y, b.w * v, b.h, colorOf(k, P.color, "#00e5ff", op), radius, k.num(P.glow, 0.f));
        }
    }

    // ---- beat pulse rings -------------------------------------------------
    void passBeat(const Component& k, float /*dtMs*/) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        const int rings = std::max(1, std::min(6, (int)k.num(P.rings, 2.f)));
        const float minS = std::max(0.02f, k.num(P.pulseMin, 0.3f));
        const float maxS = std::max(minS + 0.05f, k.num(P.pulseMax, 1.f));
        const float thick = std::max(1.f, k.num(P.thickness, 0.02f) * std::min(b.w, b.h));
        const Rgba base = colorOf(k, P.color, "#ffffff", opacityOf(k));
        const float cx = b.x + b.w * 0.5f, cy = b.y + b.h * 0.5f;
        // Rings are true circles inscribed in the box: using w/h directly
        // would squash them into ovals on non-square boxes.
        const float dia = std::min(b.w, b.h);
        for (int i = 0; i < rings; ++i) {
            float ph = beatPhase - i * 0.14f;
            while (ph < 0.f) ph += 1.f;
            const float s = minS + (maxS - minS) * ph;
            float* cmd = pushCmd(OP_CIRCLE);
            if (!cmd) return;
            cmd[C_X] = cx - dia * 0.5f * s;
            cmd[C_Y] = cy - dia * 0.5f * s;
            cmd[C_W] = dia * s;
            cmd[C_H] = dia * s;
            cmd[C_P0] = thick;
            Rgba c = base;
            c.a *= (1.f - ph) * (0.35f + 0.65f * beatPulse);
            setColor(cmd, c);
        }
    }

    /**
     * Filled orb that flares on the beat — the "Track Nation" look: a soft
     * bloomed halo with a bright core sitting in the middle, both scaling with
     * the beat phase and an energy follower (bass by default) so it breathes
     * even between beats.
     */
    void passBeatGlow(const Component& k, float /*dtMs*/) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        const float cx = b.x + b.w * 0.5f, cy = b.y + b.h * 0.5f;
        const float base = std::max(0.05f, std::min(b.w, b.h));

        // follow = 0 -> pure beat phase, 1 -> continuous energy level
        const float energy = levelOf(AS_BASS);
        const float followMix = std::max(0.f, std::min(1.f, k.num(P.follow, 1.f)));
        const float drive = beatPhase * (1.f - followMix) + energy * followMix;
        const float intensity = std::max(0.f, k.num(P.intensity, 1.f));
        const float flare = std::min(2.f, drive * intensity);

        const Rgba halo = colorOf(k, P.haloColor, "#7c5cff", opacityOf(k));
        const Rgba core = colorOf(k, P.color, "#ffffff", opacityOf(k));

        // outer halo: soft radial fade, scaled hard by the flare
        const float haloR = base * std::max(0.05f, k.num(P.haloSize, 1.35f)) *
                            (1.f + 0.35f * flare);
        float* h = pushCmd(OP_RADIAL_GLOW);
        if (!h) return;
        h[C_X] = cx - haloR; h[C_Y] = cy - haloR;
        h[C_W] = haloR * 2.f; h[C_H] = haloR * 2.f;
        setColor(h, halo);
        Rgba h2 = halo;
        h2.a *= std::max(0.f, std::min(1.f, k.num(P.haloOpacity, 0.85f)));
        setColor2(h, h2);
        h[C_P0] = 0.05f;                                   // solid core fraction
        h[C_P1] = 0.62f;                                   // where the falloff starts
        h[C_P2] = std::max(0.f, k.num(P.bloom, 0.5f));     // falloff tightness
        h[C_P3] = 0.5f * std::min(1.f, flare);             // peak alpha scale

        // inner bloom: tighter, brighter, uses the same flare
        const float bloomR = base * std::max(0.05f, k.num(P.coreSize, 0.55f)) *
                             (1.f + 0.22f * flare);
        float* g = pushCmd(OP_RADIAL_GLOW);
        if (!g) return;
        g[C_X] = cx - bloomR; g[C_Y] = cy - bloomR;
        g[C_W] = bloomR * 2.f; g[C_H] = bloomR * 2.f;
        setColor(g, core);
        Rgba g2 = core;
        g2.a *= 0.55f + 0.45f * std::min(1.f, flare);
        setColor2(g, g2);
        g[C_P0] = 0.12f;
        g[C_P1] = 0.30f;
        g[C_P2] = std::max(0.f, k.num(P.bloom, 0.5f)) * 0.6f;
        g[C_P3] = 0.5f;
    }

    /**
     * Cover component: the track artwork drawn with a border radius (or circle
     * mask), wrapped in a radial spectrum ring, with a soft glow and a beat
     * pulse. Everything reuses existing opcodes (radial glow, polygons, image),
     * so the Canvas2D and Android backends need no new primitives.
     */
    void passCover(Component& k, float dtMs) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const float op = opacityOf(k);
        float cx, cy;
        effectCenter(k, b.x, b.y, b.w, b.h, cx, cy);
        // Image anchor: the art stays glued to the box middle; centerX/Y
        // move only the effect (rings, loops, glow) relative to it.
        const float ix = b.x + b.w * 0.5f, iy = b.y + b.h * 0.5f;
        const float base = std::max(1.f, std::min(b.w, b.h)) * 0.5f;

        // Beat + bass energy drives the glow and the pulse.
        const float energy = std::max(beatPulse, levelOf(AS_BASS));
        const float pulseAmt = std::max(0.f, std::min(0.9f, k.num(P.pulseAmount, 0.12f)));
        const float pulse = 1.f + pulseAmt * energy;
        const float glow = std::max(0.f, k.num(P.glow, 0.f));

        const Rgba c1 = colorOf(k, P.color, "#00e5ff", op);
        const Rgba c2 = colorOf(k, P.color2, "#ff2d95", op);

        // ---- halo / glow behind the cover ----
        if (glow > 0.05f) {
            const float gr = base * (1.05f + 0.35f * pulseAmt * energy) + glow;
            float* h = pushCmd(OP_RADIAL_GLOW);
            if (h) {
                const Rgba halo = colorOf(k, P.haloColor, "#7c5cff", op);
                h[C_X] = cx - gr; h[C_Y] = cy - gr; h[C_W] = gr * 2.f; h[C_H] = gr * 2.f;
                setColor(h, halo);
                Rgba h2 = halo;
                h2.a *= op * std::max(0.f, std::min(1.f, 0.25f + 0.6f * energy)) *
                        std::min(1.f, glow / 18.f);
                setColor2(h, h2);
                h[C_P0] = 0.02f; h[C_P1] = 0.62f; h[C_P2] = 0.5f;
                h[C_P3] = op * std::max(0.f, std::min(0.7f, 0.18f + 0.55f * energy));
            }
        }

        // ---- radial spectrum ring ----
        const int bars = std::max(1, std::min(256, (int)k.num(P.radialBars, 64.f)));
        if ((int)k.heat.size() != bars) {
            k.heat.assign(bars, 0.f);
            k.pk.assign(bars, 0.f);
            k.ph.assign(bars, 0.f);
        }

        const float inner = std::max(0.f, std::min(0.98f, k.num(P.ringRadius, 0.4f)));
        const float lenMax = std::max(0.01f, k.num(P.radialLength, 0.5f)) * base;
        const float gapFrac = std::max(0.f, std::min(0.95f, k.num(P.radialGap, 0.3f)));
        const float arcStart = k.num(P.arcStart, 0.f);
        const float arcSpan = std::max(1.f, std::min(360.f, k.num(P.arcSpan, 360.f)));
        const float gain = k.num(P.radialGain, 1.2f);
        const float tiltDb = k.num(P.tilt, 0.f);
        const float attack = 1.f - std::max(0.f, std::min(0.99f, k.num(P.radialSmoothing, 0.5f)));
        const float release = 1.f - std::max(0.f, std::min(0.999f, k.num(P.radialDecay, 0.85f)));
        const bool peaks = k.flag(P.radialPeaks, false);
        const Rgba pc = colorOf(k, P.radialPeakColor, "#ffffff");
        const float peakThick = std::max(1.f, k.num(P.peakWidth, 4.f));
        const float peakFall = std::max(0.f, k.num(P.peakFall, 1.1f));
        const float peakDelay = std::max(0.f, k.num(P.peakDelay, 0.f));
        const float peakGap = std::max(0.f, k.num(P.peakGap, 0.f));
        const bool mirror = k.flag(P.mirror, false);   // fold symmetric about the vertical centre

        const float innerR = inner * base;
        const float slotDeg = arcSpan / bars;
        const float barFrac = std::max(0.02f, 1.f - gapFrac);

        for (int i = 0; i < bars; ++i) {
            float t = bars <= 1 ? 0.f : (float)i / (bars - 1);
            if (mirror) t = 1.f - std::fabs(2.f * t - 1.f);
            const int band = std::max(0, std::min(kBands - 1, (int)(t * (kBands - 1) + 0.5f)));
            const float raw = std::max(0.f, std::min(1.f, tiltedBand(band, tiltDb) * gain));
            const float prev = k.heat[i];
            k.heat[i] = prev + (raw - prev) * (raw > prev ? attack : release);

            const float v = std::max(0.f, std::min(1.f, k.heat[i]));
            const float len = (0.05f + 0.95f * v) * lenMax * pulse;
            const float a = (arcStart + slotDeg * (i + 0.5f)) * kPi / 180.f;
            const float ux = std::sin(a), uy = -std::cos(a);      // outward
            const float tx = std::cos(a), ty = std::sin(a);       // tangential
            const float r0 = innerR;
            const float r1 = innerR + len;
            const float midR = (r0 + r1) * 0.5f;
            const float halfW = std::max(0.5f, std::sin(barFrac * slotDeg * kPi / 360.f) * midR);

            const int at = (int)points.size() / 2;
            if (at * 2 + 8 > kMaxPoints * 2) break;
            pushPoint(cx + ux * r0 + tx * halfW, cy + uy * r0 + ty * halfW);
            pushPoint(cx + ux * r1 + tx * halfW, cy + uy * r1 + ty * halfW);
            pushPoint(cx + ux * r1 - tx * halfW, cy + uy * r1 - ty * halfW);
            pushPoint(cx + ux * r0 - tx * halfW, cy + uy * r0 - ty * halfW);
            float* cmd = pushCmd(OP_POLYGON);
            if (!cmd) break;
            cmd[C_P0] = 4.f; cmd[C_P1] = (float)at; cmd[C_P2] = 0.f;
            Rgba bc = mixRgba(c1, c2, t);
            setColor(cmd, bc);

            if (peaks) {
                const float want = r1;
                if (want > k.pk[i]) {
                    k.pk[i] = want;
                    k.ph[i] = 0.f;
                } else {
                    // Same "stop delay" as spectrum: hold still, then fall.
                    k.ph[i] += dtMs / 1000.f;
                    if (k.ph[i] >= peakDelay) {
                        k.pk[i] = std::max(innerR, k.pk[i] - peakFall * base * dtMs / 1000.f);
                    }
                }
                // Never let the cap sink back inside its own bar.
                const float pr = std::max(k.pk[i], r1 + peakGap);
                const float pr0 = std::max(innerR, pr - peakThick);
                Rgba pcol = pc; pcol.a *= op;
                const int pt = (int)points.size() / 2;
                if (pt * 2 + 8 <= kMaxPoints * 2) {
                    pushPoint(cx + ux * pr0 + tx * halfW, cy + uy * pr0 + ty * halfW);
                    pushPoint(cx + ux * pr + tx * halfW, cy + uy * pr + ty * halfW);
                    pushPoint(cx + ux * pr - tx * halfW, cy + uy * pr - ty * halfW);
                    pushPoint(cx + ux * pr0 - tx * halfW, cy + uy * pr0 - ty * halfW);
                    float* pcmd = pushCmd(OP_POLYGON);
                    if (pcmd) {
                        pcmd[C_P0] = 4.f; pcmd[C_P1] = (float)pt; pcmd[C_P2] = 0.f;
                        setColor(pcmd, pcol);
                    }
                }
            }
        }

        // ---- the cover art itself ----
        const int imgId = resolveImageId(k, P.image, "0");
        if (imgId == 0) return;
        const float imgPulse = k.flag(P.imagePulse, true) ? pulse : 1.f;
        const float size = std::max(1.f, std::min(1.f, k.num(P.coverScale, 0.62f)) * base * 2.f * imgPulse);
        float* img = pushCmd(OP_IMAGE);
        if (!img) return;
        const float radius = k.num(P.cornerRadius, 0.f) * size * 0.5f;
        float iboxX, iboxY, iboxW, iboxH;
        centerImageBox(k, ix, iy, size, iboxX, iboxY, iboxW, iboxH);
        img[C_X] = iboxX; img[C_Y] = iboxY;
        img[C_W] = iboxW; img[C_H] = iboxH;
        img[C_P0] = (float)(int)k.num(P.fit, (float)FIT_COVER);
        img[C_P1] = radius;
        img[C_P2] = k.num(P.tint, 0.f);
        img[C_P3] = std::max(0.f, k.num(P.blur, 0.f));
        img[C_ROLE] = k.flag(P.circle, false) ? 1.f : 0.f;
        img[C_P4] = k.flag(P.flipX, false) ? 1.f : 0.f;
        img[C_P5] = k.flag(P.flipY, false) ? 1.f : 0.f;
        img[C_IMG] = (float)imgId;
        img[C_A] = op;
        setColor(img, colorOf(k, P.tintColor, "#ffffff"));
    }

    /**
     * Orb component: like `cover` but the ring is made of glow spectrum LINES
     * instead of bars — closed wavy loops whose radius follows the audio,
     * drawn as 3 stacked strokes (core + two soft falloffs) for a neon bloom
     * that needs no backend blur support. The middle holds the cover art (or
     * a glow core when no art is loaded), everything breathing with the beat.
     */
    void passOrb(Component& k, float dtMs) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const float op = opacityOf(k);
        float cx, cy;
        effectCenter(k, b.x, b.y, b.w, b.h, cx, cy);
        // Image anchor: the art stays glued to the box middle; centerX/Y
        // move only the effect (rings, loops, glow) relative to it.
        const float ix = b.x + b.w * 0.5f, iy = b.y + b.h * 0.5f;
        const float base = std::max(1.f, std::min(b.w, b.h)) * 0.5f;

        const float energy = std::max(beatPulse, levelOf(AS_BASS));
        const float pulseAmt = std::max(0.f, std::min(0.9f, k.num(P.pulseAmount, 0.14f)));
        const float pulse = 1.f + pulseAmt * energy;
        const float glow = std::max(0.f, k.num(P.glow, 0.f));

        const Rgba c1 = colorOf(k, P.color, "#7dffd4");
        const Rgba c2 = colorOf(k, P.color2, "#00e5ff");

        // ---- halo behind everything ----
        if (glow > 0.05f) {
            const float gr = base * 1.5f * pulse + glow;
            float* h = pushCmd(OP_RADIAL_GLOW);
            if (h) {
                const Rgba halo = colorOf(k, P.haloColor, "#00e5ff");
                h[C_X] = cx - gr; h[C_Y] = cy - gr; h[C_W] = gr * 2.f; h[C_H] = gr * 2.f;
                setColor(h, halo);
                Rgba h2 = halo;
                h2.a *= op * std::min(1.f, glow / 18.f);
                setColor2(h, h2);
                h[C_P0] = 0.02f; h[C_P1] = 0.6f; h[C_P2] = 0.5f;
                h[C_P3] = op * std::max(0.f, std::min(0.55f, 0.14f + 0.45f * energy));
            }
        }

        // ---- glow spectrum rings ----
        const int rings = std::max(1, std::min(6, (int)k.num(P.rings, 3.f)));
        const int pts = std::max(24, std::min(512, (int)k.num(P.linePoints, 160.f)));
        if ((int)k.heat.size() != rings * pts) { k.heat.assign(rings * pts, 0.f); k.pk.assign(rings * pts, 0.f); }

        const float inner = std::max(0.f, std::min(0.95f, k.num(P.ringRadius, 0.42f)));
        const float step = std::max(0.02f, 0.08f + std::max(0.f, std::min(0.9f, k.num(P.gap, 0.3f))) * 0.3f);
        const float wave = std::max(0.01f, k.num(P.radialLength, 0.5f)) * base;
        const float gain = k.num(P.gain, 1.25f);
        const float tiltDb = k.num(P.tilt, 0.f);
        const float attack = 1.f - std::max(0.f, std::min(0.99f, k.num(P.smoothing, 0.5f)));
        const float release = 1.f - std::max(0.f, std::min(0.999f, k.num(P.decay, 0.86f)));
        const float sw = std::max(1.f, k.num(P.thickness, 0.014f) * std::min(b.w, b.h));
        const bool mirror = k.flag(P.mirror, false);   // fold symmetric about the vertical centre
        // Start angle rotates the whole display (data mapping stays put).
        const float arc0 = k.num(P.arcStart, 0.f) * kPi / 180.f;
        // Mirrored rings hold still so the symmetry stays on the vertical axis.
        const float rot = (mirror ? 0.f : timeMs / 1000.f * 8.f * kPi / 180.f) + arc0;
        // Angular smoothing blurs each ring across its neighbours so adjacent
        // bands never spike sharp; 0 keeps the raw band edges.
        const float angSm = std::max(0.f, std::min(0.95f, k.num(P.angularSmooth, 0.f)));
        // Palette rings: every ring takes one solid palette role (vivid first)
        // instead of the two-colour gradient across rings.
        const bool palRings = k.flag(P.paletteRings, false);
        static const int palOrder[6] = {2, 3, 4, 5, 1, 0};
        // Glass-floor reflection: one faded flipped copy below the box.
        const bool reflect = k.flag(P.reflection, false);
        const float floorY = b.y + b.h;

        // Solid inner disc, out to the innermost ring (opacity 0 = off).
        const float fillOp = std::max(0.f, std::min(1.f, k.num(P.fillOpacity, 0.f)));
        if (fillOp > 0.001f) {
            float* d = pushCmd(OP_CIRCLE);
            if (d) {
                const float fr = inner * base * pulse;
                d[C_X] = cx - fr; d[C_Y] = cy - fr; d[C_W] = fr * 2.f; d[C_H] = fr * 2.f;
                d[C_P0] = 0.f;
                setColor(d, colorOf(k, P.fillColor, "#00e5ff", fillOp * op));
            }
        }

        auto emitLoop = [&](int j, float baseR, const Rgba& col, float width, float cyy, float dir) -> bool {
            const int at = (int)points.size() / 2;
            if (at + pts + 2 > kMaxPoints) return false;
            for (int i = 0; i < pts; ++i) {
                const float v = std::max(0.f, std::min(1.f, k.heat[j * pts + i]));
                const float a = rot + (float)i / pts * 2.f * kPi;
                const float r = (baseR + wave * v) * pulse;
                pushPoint(cx + std::cos(a) * r, cyy + dir * std::sin(a) * r);
            }
            float* cmd = pushCmd(OP_POLYGON);
            if (!cmd) return false;
            cmd[C_P0] = (float)pts; cmd[C_P1] = (float)at; cmd[C_P2] = width;
            setColor(cmd, col);
            return true;
        };

        for (int j = 0; j < rings; ++j) {
            const float baseR = (inner + step * j) * base;
            const float tj = rings <= 1 ? 0.f : (float)j / (rings - 1);
            Rgba rc = palRings ? roleColor(palOrder[j % 6], op) : mixRgba(c1, c2, tj);
            if (!palRings) rc.a *= op;
            for (int i = 0; i < pts; ++i) {
                const float t = (float)i / pts;
                const float tt = mirror ? 1.f - std::fabs(2.f * t - 1.f) : t;
                const int band = std::max(0, std::min(kBands - 1, (int)(tt * (kBands - 1) + 0.5f)));
                const float raw = std::max(0.f, std::min(1.f, tiltedBand(band, tiltDb) * gain));
                float& cell = k.heat[j * pts + i];
                cell += (raw - cell) * (raw > cell ? attack : release);
                (void)cell;
            }
            if (angSm > 0.001f) {
                if ((int)scratch.size() < pts) scratch.assign(pts, 0.f);
                float* row = &k.heat[j * pts];
                for (int i = 0; i < pts; ++i) scratch[i] = row[i];
                for (int i = 0; i < pts; ++i) {
                    const float nb = 0.5f * (scratch[(i + pts - 1) % pts] + scratch[(i + 1) % pts]);
                    row[i] = scratch[i] * (1.f - angSm) + nb * angSm;
                }
            }
            // 3 stacked strokes = core + bloom falloff, no backend blur needed
            const float widths[3] = {sw, sw * 2.6f, sw * 5.5f};
            const float alphas[3] = {1.f, 0.32f, 0.12f};
            for (int pass = 0; pass < 3; ++pass) {
                Rgba pc = rc;
                pc.a *= alphas[pass];
                if (!emitLoop(j, baseR, pc, widths[pass], cy, 1.f)) break;
            }
            if (reflect) {
                Rgba fc = rc;
                fc.a *= 0.3f;
                emitLoop(j, baseR, fc, sw, 2.f * floorY - cy, -1.f);
            }
        }

        // ---- the middle: cover art, or a glow core without art ----
        const int imgId = resolveImageId(k, P.image, "0");
        if (imgId != 0) {
            const float imgPulse = k.flag(P.imagePulse, true) ? pulse : 1.f;
            const float size = std::max(1.f, std::min(1.f, k.num(P.coverScale, 0.5f)) * base * 2.f * imgPulse);
            float* img = pushCmd(OP_IMAGE);
            if (img) {
                const float radius = k.num(P.cornerRadius, 0.f) * size * 0.5f;
                float iboxX, iboxY, iboxW, iboxH;
                centerImageBox(k, ix, iy, size, iboxX, iboxY, iboxW, iboxH);
                img[C_X] = iboxX; img[C_Y] = iboxY;
                img[C_W] = iboxW; img[C_H] = iboxH;
                img[C_P0] = (float)(int)k.num(P.fit, (float)FIT_COVER);
                img[C_P1] = radius;
                img[C_P2] = k.num(P.tint, 0.f);
                img[C_P3] = std::max(0.f, k.num(P.blur, 0.f));
                img[C_ROLE] = k.flag(P.circle, true) ? 1.f : 0.f;
                img[C_P4] = k.flag(P.flipX, false) ? 1.f : 0.f;
                img[C_P5] = k.flag(P.flipY, false) ? 1.f : 0.f;
                img[C_IMG] = (float)imgId;
                img[C_A] = op;
                setColor(img, colorOf(k, P.tintColor, "#ffffff"));
            }
        } else {
            const float cr = base * std::max(0.05f, k.num(P.coreSize, 0.5f)) * pulse;
            float* g = pushCmd(OP_RADIAL_GLOW);
            if (g) {
                g[C_X] = ix - cr; g[C_Y] = iy - cr; g[C_W] = cr * 2.f; g[C_H] = cr * 2.f;
                setColor(g, c1);
                Rgba g2 = c1;
                g2.a *= op;
                setColor2(g, g2);
                g[C_P0] = 0.1f; g[C_P1] = 0.35f; g[C_P2] = 0.4f; g[C_P3] = op * 0.5f;
            }
        }
    }

    /**
     * Song progress bar. Unlike `meter` (live audio levels only), this reads
     * the numeric `positionSec`/`durationSec` variables the host publishes, so
     * it tracks the actual track position. Renders as a filled bar over a
     * dimmed track, left to right.
     */
    void passProgress(const Component& k) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const float op = opacityOf(k);
        const float pos = vars.num("positionSec", 0.f);
        const float dur = vars.num("durationSec", 0.f);
        const float v = dur > 0.5f ? std::max(0.f, std::min(1.f, pos / dur)) : 0.f;
        const float radius = k.num(P.cornerRadius, 0.f) * std::min(b.w, b.h) * 0.5f;
        const Rgba c = colorOf(k, P.color, "#ffffff");

        const float trackA = std::max(0.f, std::min(1.f, k.num(P.trackOpacity, 0.18f))) * op;
        emitRect(b.x, b.y, b.w, b.h, colorOf(k, P.trackColor, "#ffffff", trackA), radius, 0.f);
        if (v > 0.f) {
            if (k.flag(P.gradient, false)) {
                Rgba a = c; a.a *= op;
                Rgba bb = colorOf(k, P.color2, "#4d7cff"); bb.a *= op;
                emitGradientRect(b.x, b.y, b.w * v, b.h, a, bb, k.num(P.gradientAngle, 90.f), radius);
            } else {
                Rgba a = c; a.a *= op;
                emitRect(b.x, b.y, b.w * v, b.h, a, radius, k.num(P.glow, 0.f));
            }
        }

        // Optional image thumb (e.g. the Winamp posbar handle): rides at the
        // fill edge, vertically centred, scaled from the bar height.
        const int thumbId = resolveImageId(k, P.thumb, "0");
        if (thumbId != 0) {
            float iw = 27.f, ih = 10.f;
            auto it = images.find(thumbId);
            if (it != images.end() && it->second.first > 0.f && it->second.second > 0.f) {
                iw = it->second.first;
                ih = it->second.second;
            }
            const float th = b.h * std::max(0.5f, std::min(4.f, k.num(P.thumbScale, 1.5f)));
            const float tw = th * iw / std::max(1.f, ih);
            const float tx = b.x + std::max(0.f, std::min(b.w - tw, b.w * v - tw * 0.5f));
            float* img = pushCmd(OP_IMAGE);
            if (img) {
                img[C_X] = tx; img[C_Y] = b.y + (b.h - th) * 0.5f;
                img[C_W] = tw; img[C_H] = th;
                img[C_P0] = (float)FIT_STRETCH;
                img[C_P1] = 0.f;
                img[C_P2] = 0.f;
                img[C_P3] = 0.f;
                img[C_ROLE] = 0.f;
                img[C_P4] = 0.f;
                img[C_P5] = 0.f;
                img[C_IMG] = (float)thumbId;
                img[C_A] = op;
                setColor(img, Rgba{1, 1, 1, 1});
            }
        }
    }

    /**
     * Radial line: a single circular waveform/spectrum loop — one crisp
     * stroke by default, optional neon bloom via the glow prop. A gradient
     * around the loop is built from arc segments; a solid color draws as one
     * continuous polygon so there are no joints.
     */
    void passRadialLine(Component& k) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const float op = opacityOf(k);
        float cx, cy;
        effectCenter(k, b.x, b.y, b.w, b.h, cx, cy);
        // Image anchor: the art stays glued to the box middle; centerX/Y
        // move only the effect (rings, loops, glow) relative to it.
        const float ix = b.x + b.w * 0.5f, iy = b.y + b.h * 0.5f;
        const float base = std::max(1.f, std::min(b.w, b.h)) * 0.5f;

        const int pts = std::max(24, std::min(512, (int)k.num(P.linePoints, 160.f)));
        if ((int)k.wave.size() != pts) k.wave.assign(pts, 0.f);

        const int mode = (int)k.num(P.lineMode, 0.f);  // 0 waveform, 1 spectrum curve
        const float gain = k.num(P.gain, 1.f);
        const float tiltDb = k.num(P.tilt, 0.f);
        const float smooth = std::max(0.f, std::min(0.95f, k.num(P.smoothing, 0.45f)));
        const bool mirror = k.flag(P.mirror, false);   // fold left/right symmetric
        const float baseR = std::max(0.f, std::min(0.98f, k.num(P.ringRadius, 0.6f))) * base;
        const float amp = std::max(0.01f, k.num(P.radialLength, 0.4f)) * base;
        const float sw = std::max(1.f, k.num(P.strokeWidth, 0.008f) * surfH);
        const bool gradient = k.flag(P.gradient, false);
        const float glowAmt = std::max(0.f, k.num(P.glow, 0.f));
        const int passes = glowAmt > 0.05f ? 3 : 1;
        // Start angle rotates the whole loop (data mapping stays put).
        const float arc0 = k.num(P.arcStart, 0.f) * kPi / 180.f;
        const Rgba c1 = colorOf(k, P.color, "#00e5ff", op);
        const Rgba c2 = colorOf(k, P.color2, "#ff2d95", op);

        const float energy = std::max(beatPulse, levelOf(AS_BASS));
        const float pulse = 1.f + std::max(0.f, std::min(0.9f, k.num(P.pulseAmount, 0.08f))) * energy;

        for (int i = 0; i < pts; ++i) {
            // Mirror folds the loop symmetric: seam at band 0, peak opposite.
            float u = (float)i / (float)(pts - 1);
            if (mirror) u = 1.f - std::fabs(2.f * u - 1.f);
            float target;
            if (mode == 0) {
                target = inBuf[(int)(u * (kFftSize - 1))];
            } else {
                const int band = std::max(0, std::min(kBands - 1, (int)(u * (kBands - 1) + 0.5f)));
                target = tiltedBand(band, tiltDb) * gain;
            }
            k.wave[i] += (target - k.wave[i]) * (1.f - smooth);
        }

        // Closed-loop Catmull-Rom resampling so waveform loops are rounded,
        // not angular. Values wrap around the seam.
        const int out = std::min(pts * 4, 1024);
        if ((int)scratch.size() < out) scratch.assign(out, 0.f);
        auto rsample = [&](int i) -> float {
            int m = i % pts;
            if (m < 0) m += pts;
            return k.wave[m];
        };
        for (int j = 0; j < out; ++j) {
            const float fi = (float)j * pts / out;
            const int i = (int)fi;
            const float t = fi - i;
            const float p0 = rsample(i - 1), p1 = rsample(i), p2 = rsample(i + 1), p3 = rsample(i + 2);
            scratch[j] = 0.5f * ((2.f * p1) + (-p0 + p2) * t +
                (2.f * p0 - 5.f * p1 + 4.f * p2 - p3) * t * t +
                (-p0 + 3.f * p1 - 3.f * p2 + p3) * t * t * t);
        }
        auto loopPt = [&](int j, float& x, float& y) {
            const float a = arc0 + (float)(j % out) / out * 2.f * kPi;
            const float r = (baseR + scratch[j % out] * amp) * pulse;
            x = cx + std::cos(a) * r;
            y = cy + std::sin(a) * r;
        };

        const float widths[3] = {sw, sw * (1.f + glowAmt / 10.f), sw * (1.f + glowAmt / 3.5f)};
        const float alphas[3] = {1.f, 0.35f, 0.15f};
        for (int pass = 0; pass < passes; ++pass) {
            if (!gradient) {
                // One continuous loop — no joints, no double lines.
                const int at = (int)points.size() / 2;
                if (at + out + 2 > kMaxPoints) break;
                for (int j = 0; j <= out; ++j) {
                    float x, y;
                    loopPt(j, x, y);
                    pushPoint(x, y);
                }
                float* cmd = pushCmd(OP_POLYGON);
                if (!cmd) break;
                cmd[C_P0] = (float)(out + 1); cmd[C_P1] = (float)at; cmd[C_P2] = widths[pass];
                Rgba mc = c1;
                mc.a *= alphas[pass];
                setColor(cmd, mc);
                continue;
            }
            // Gradient around the loop needs arc segments, one stroked
            // polygon per segment for per-vertex colour.
            const int SEGS = 24;
            for (int s = 0; s < SEGS; ++s) {
                const int i0 = s * out / SEGS;
                const int i1 = (s + 1) * out / SEGS;
                const int n = i1 - i0 + 1;
                const int at = (int)points.size() / 2;
                if (at + n + 1 > kMaxPoints) break;
                for (int j = i0; j <= i1; ++j) {
                    float x, y;
                    loopPt(j, x, y);
                    pushPoint(x, y);
                }
                float* cmd = pushCmd(OP_POLYGON);
                if (!cmd) break;
                cmd[C_P0] = (float)n; cmd[C_P1] = (float)at; cmd[C_P2] = widths[pass];
                Rgba mc = mixRgba(c1, c2, (float)s / SEGS);
                mc.a *= alphas[pass];
                setColor(cmd, mc);
            }
        }

        // Center image, like the cover component's middle.
        const int imgId = resolveImageId(k, P.image, "0");
        if (imgId != 0) {
            const float csize = std::max(1.f, std::min(1.f, k.num(P.coverScale, 0.5f)) * base * 2.f * pulse);
            float* img = pushCmd(OP_IMAGE);
            if (img) {
                float iboxX, iboxY, iboxW, iboxH;
                centerImageBox(k, ix, iy, csize, iboxX, iboxY, iboxW, iboxH);
                img[C_X] = iboxX; img[C_Y] = iboxY;
                img[C_W] = iboxW; img[C_H] = iboxH;
                img[C_P0] = (float)(int)k.num(P.fit, (float)FIT_COVER);
                img[C_P1] = k.num(P.cornerRadius, 0.5f) * csize * 0.5f;
                img[C_P2] = 0.f;
                img[C_P3] = 0.f;
                img[C_ROLE] = k.flag(P.circle, true) ? 1.f : 0.f;
                img[C_P4] = 0.f;
                img[C_P5] = 0.f;
                img[C_IMG] = (float)imgId;
                img[C_A] = op;
                setColor(img, Rgba{1, 1, 1, 1});
            }
        }
    }

    // ---- particles (embers / snow / dust / stars / beat sparks) -----------
    void spawnParticle(Component& k, int i, int mode, int shapeProp, bool scatter) {
        const float r1 = frand(), r2 = frand(), r3 = frand(), r4 = frand();
        float* q = &k.parts[(size_t)i * 7];
        float life = 3.f;
        switch (mode) {
            case 1:  // snow: top, drifting down
                q[0] = r1; q[1] = scatter ? r2 : -0.05f;
                q[2] = (r3 - 0.5f) * 0.05f; q[3] = 0.06f + r2 * 0.12f;
                life = 6.f + r2 * 6.f;
                break;
            case 2:  // dust: anywhere, slow omni drift
                q[0] = r1; q[1] = r2;
                q[2] = (r1 - 0.5f) * 0.08f; q[3] = (r2 - 0.5f) * 0.08f;
                life = 4.f + r3 * 5.f;
                break;
            case 3:  // stars: static, twinkle only
                q[0] = r1; q[1] = r2; q[2] = 0.f; q[3] = 0.f;
                life = 6.f + r3 * 8.f;
                break;
            case 4: {  // beat sparks: burst from the centre
                const float a = r1 * 2.f * kPi;
                const float sp = 0.25f + r2 * 0.5f;
                q[0] = 0.5f; q[1] = 0.5f;
                q[2] = std::cos(a) * sp; q[3] = std::sin(a) * sp;
                life = 0.8f + r3 * 0.9f;
                break;
            }
            case 5: {  // tunnel: slow drift out, motion code accelerates it
                const float a = r1 * 2.f * kPi;
                const float d0 = 0.02f + r2 * 0.1f;
                q[0] = 0.5f + std::cos(a) * d0; q[1] = 0.5f + std::sin(a) * d0;
                q[2] = std::cos(a) * 0.05f; q[3] = std::sin(a) * 0.05f;
                life = 3.f + r3 * 4.f;
                break;
            }
            default:  // embers: bottom, rising
                q[0] = r1; q[1] = scatter ? r2 : 1.02f;
                q[2] = (r3 - 0.5f) * 0.06f; q[3] = -(0.12f + r2 * 0.25f);
                life = 2.5f + r2 * 3.f;
                break;
        }
        q[4] = scatter ? r2 * life : 0.f;  // age
        q[5] = life;
        q[6] = (shapeProp == 5) ? (float)((int)(r4 * 5.f) % 5) : (float)shapeProp;
    }

    void passParticles(Component& k, float dtMs) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const float op = opacityOf(k);
        const int mode = std::max(0, std::min(5, (int)k.num(P.mode, 0.f)));
        const int count = std::max(0, std::min(600, (int)k.num(P.count, 120.f)));
        if (count <= 0) return;
        const int shapeProp = std::max(0, std::min(5, (int)k.num(P.shape, 0.f)));
        if ((int)k.parts.size() != count * 7) {
            k.parts.assign((size_t)count * 7, 0.f);
            for (int i = 0; i < count; ++i) spawnParticle(k, i, mode, shapeProp, true);
        }

        const float speed = std::max(0.f, k.num(P.speed, 1.f));
        const float sway = std::max(0.f, std::min(1.f, k.num(P.sway, 0.5f)));
        const float grav = k.num(P.gravity, 0.f);
        const float tw = std::max(0.f, std::min(1.f, k.num(P.twinkle, 0.6f)));
        const float bb = std::max(0.f, std::min(2.f, k.num(P.beatBoost, 0.8f)));
        const float sizeBase = std::max(0.0005f, k.num(P.size, 0.015f)) * std::min(b.w, b.h);
        const float sizeVar = std::max(0.f, std::min(1.f, k.num(P.sizeVar, 0.f)));
        // Random rotation per particle (stable hash, never flickers). Squares
        // become rotated quads; triangles and hearts rotate too. Circles are
        // symmetric and lines follow their motion, so both skip it.
        const float rotAmt = std::max(0.f, std::min(1.f, k.num(P.rotation, 0.f)));
        const int colorMode = std::max(0, std::min(4, (int)k.num(P.colorMode, 0.f)));
        const bool gradient = k.flag(P.gradient, false);
        const Rgba c1 = colorOf(k, P.color, "#ffb14d", op);
        const Rgba c2 = colorOf(k, P.color2, "#ff5f6d", op);

        const float dt = std::max(0.001f, std::min(0.1f, dtMs / 1000.f));
        const float energy = std::max(beatPulse, levelOf(AS_BASS));
        const float boost = 1.f + bb * energy;
        const float t = (float)(timeMs / 1000.0);
        const float tunnel = (mode == 5) ? 1.f : 0.f;

        for (int i = 0; i < count; ++i) {
            float* q = &k.parts[(size_t)i * 7];
            const float ph = std::fmod((float)i * 0.618034f, 1.f);
            float age = q[4] + dt;
            const float rad = std::hypot(q[0] - 0.5f, q[1] - 0.5f);
            if (age >= q[5] || q[0] < -0.1f || q[0] > 1.1f || q[1] < -0.15f || q[1] > 1.15f ||
                (tunnel > 0.5f && rad > 0.75f)) {
                spawnParticle(k, i, mode, shapeProp, false);
                q = &k.parts[(size_t)i * 7];
                age = 0.f;
            }
            q[4] = age;
            const float sp = speed * (mode == 4 ? 0.6f + boost * 0.9f : boost);
            if (tunnel > 0.5f) {
                // Accelerating radial flight: the longer it flies, the faster.
                const float acc = 1.f + age * 2.2f * speed;
                q[0] += q[2] * sp * acc * dt * 3.f;
                q[1] += q[3] * sp * acc * dt * 3.f;
            } else {
                q[3] += grav * dt * (mode == 4 ? 1.f : 0.3f);
                q[0] += (q[2] * sp + std::sin(t * (1.f + ph * 2.f) + ph * 6.283f) * sway * 0.12f) * dt;
                q[1] += q[3] * sp * dt;
            }

            const float ageT = std::max(0.f, std::min(1.f, age / std::max(0.001f, q[5])));
            const float env = std::sin(ageT * kPi);   // fade in/out over life
            const float twk = (1.f - tw) + tw * (0.5f + 0.5f * std::sin(t * (2.f + 5.f * ph) + ph * 6.283f));
            Rgba A, B;
            colorPair(colorMode, (float)i * 3.7f + 1.f, c1, c2, A, B);
            Rgba pc = gradient ? mixRgba(A, B, ageT) : mixRgba(A, B, ph);
            pc.a *= env * twk * (tunnel > 0.5f ? std::min(1.f, rad * 2.5f + 0.15f) : 1.f);
            if (pc.a <= 0.004f) continue;
            // Size range: sizeVar spreads each particle between full size
            // and (1-sizeVar) of it; tunnel grows with radius (perspective).
            const float psize = sizeBase * (1.f - sizeVar * hash01(ph * 91.7f + 3.f));
            const float persp = tunnel > 0.5f ? 0.35f + rad * 2.2f : 1.f;
            const float r = std::max(0.5f, psize * (0.6f + 0.4f * env) *
                (mode == 4 ? 1.f - ageT * 0.4f : 1.f) * (1.f + 0.25f * energy * bb) * persp);
            const float cx = b.x + q[0] * b.w, cy = b.y + q[1] * b.h;
            const int sh = (int)q[6];
            // Stable per-particle rotation angle (0 when the slider is down).
            const float prot = hash01(ph * 57.31f + 11.7f) * rotAmt * 2.f * kPi;
            const float prc = std::cos(prot), prs = std::sin(prot);
            if (sh == 1) {
                if (rotAmt > 0.001f) {
                    const int at = (int)points.size() / 2;
                    if (at + 4 > kMaxPoints) return;
                    const float cn[4][2] = {{-r, -r}, {r, -r}, {r, r}, {-r, r}};
                    for (int v = 0; v < 4; ++v)
                        pushPoint(cx + cn[v][0] * prc - cn[v][1] * prs,
                                  cy + cn[v][0] * prs + cn[v][1] * prc);
                    float* cmd = pushCmd(OP_POLYGON);
                    if (!cmd) return;
                    cmd[C_P0] = 4.f; cmd[C_P1] = (float)at; cmd[C_P2] = 0.f;
                    setColor(cmd, pc);
                } else {
                    emitRect(cx - r, cy - r, r * 2.f, r * 2.f, pc, 0.f, 0.f);
                }
            } else if (sh == 2) {
                const int at = (int)points.size() / 2;
                if (at + 3 > kMaxPoints) return;
                for (int v = 0; v < 3; ++v) {
                    const float a = -kPi * 0.5f + (float)v * 2.f * kPi / 3.f + prot;
                    pushPoint(cx + std::cos(a) * r, cy + std::sin(a) * r);
                }
                float* cmd = pushCmd(OP_POLYGON);
                if (!cmd) return;
                cmd[C_P0] = 3.f; cmd[C_P1] = (float)at; cmd[C_P2] = 0.f;
                setColor(cmd, pc);
            } else if (sh == 3) {
                float vx = q[2], vy = q[3];
                const float vl = std::hypot(vx, vy);
                if (vl < 0.001f) { vx = 0.f; vy = 1.f; } else { vx /= vl; vy /= vl; }
                const float len = r * (2.f + std::min(2.f, vl * 4.f));
                float* cmd = pushCmd(OP_LINE);
                if (!cmd) return;
                cmd[C_X] = cx - vx * len * 0.5f; cmd[C_Y] = cy - vy * len * 0.5f;
                cmd[C_W] = cx + vx * len * 0.5f; cmd[C_H] = cy + vy * len * 0.5f;
                cmd[C_P0] = std::max(1.f, r * 0.4f); cmd[C_P1] = 0.f;
                setColor(cmd, pc);
            } else if (sh == 4) {
                // Heart curve: x = 16sin^3 t, y = 13cos t - 5cos 2t - 2cos 3t - cos 4t.
                const int HN = 14;
                const int at = (int)points.size() / 2;
                if (at + HN > kMaxPoints) return;
                for (int v = 0; v < HN; ++v) {
                    const float a = (float)v / HN * 2.f * kPi;
                    const float sa = std::sin(a);
                    const float hx = 16.f * sa * sa * sa / 17.f;
                    const float hy = (13.f * std::cos(a) - 5.f * std::cos(2.f * a) -
                        2.f * std::cos(3.f * a) - std::cos(4.f * a)) / 17.f;
                    const float dx = hx * r, dy = -hy * r;
                    pushPoint(cx + dx * prc - dy * prs, cy + dx * prs + dy * prc);
                }
                float* cmd = pushCmd(OP_POLYGON);
                if (!cmd) return;
                cmd[C_P0] = (float)HN; cmd[C_P1] = (float)at; cmd[C_P2] = 0.f;
                setColor(cmd, pc);
            } else {
                float* cmd = pushCmd(OP_CIRCLE);
                if (!cmd) return;
                cmd[C_X] = cx - r; cmd[C_Y] = cy - r; cmd[C_W] = r * 2.f; cmd[C_H] = r * 2.f;
                cmd[C_P0] = 0.f;
                setColor(cmd, pc);
            }
        }
    }

    // ---- dotmatrix: LED dot-grid equalizer ---------------------------------
    /**
     * A cols x rows grid of cells, one column per band, lit from the bottom.
     * Unlit cells are drawn dim so the grid reads as a panel; lit cells take a
     * per-row colour ramp. Cells are square: the fitted cell is the smaller of
     * the two cell pitches, and the grid is centred in the box.
     */
    void passDotMatrix(Component& k, float dtMs) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const float op = opacityOf(k);

        // Budget: one command per cell, dim + lit + caps, out of a shared pool.
        int cols = std::max(2, std::min(96, (int)k.num(P.cols, 32.f)));
        int rows = std::max(1, std::min(48, (int)k.num(P.rows, 16.f)));
        while (cols * rows > 2000) {                    // spec cap
            if (cols > rows) --cols; else --rows;
        }
        if ((int)k.heat.size() != cols) { k.heat.assign(cols, 0.f); k.pk.assign(cols, 0.f); k.ph.assign(cols, 0.f); }

        const float gap = std::max(0.f, std::min(0.8f, k.num(P.gap, 0.2f)));
        const float cell = std::min(b.w / cols, b.h / rows) * (1.f - gap);
        if (cell < 0.5f) return;
        const float pitch = cell / (1.f - gap);
        // Centre the fitted grid; the non-limiting axis keeps its slack.
        const float gridW = pitch * (cols - 1) + cell;
        const float gridH = pitch * (rows - 1) + cell;
        const float gx = b.x + (b.w - gridW) * 0.5f;
        const float gy = b.y + (b.h - gridH) * 0.5f;

        const int shape = std::max(0, std::min(2, (int)k.num(P.cellShape, 0.f)));
        const float radius = cell * (shape == 2 ? 0.28f : 0.f);
        const float glow = std::max(0.f, k.num(P.glow, 0.f));
        const Rgba c1 = colorOf(k, P.color, "#22e1ff", op);
        const Rgba c2 = colorOf(k, P.color2, "#ff2d95", op);
        const float tiltDb = k.num(P.tilt, 0.f);
        const float dimOp = std::max(0.f, std::min(0.5f, k.num(P.dimOpacity, 0.07f))) * op;
        Rgba dim = colorOf(k, P.dimColor, "#ffffff", dimOp);
        const Rgba pk = colorOf(k, P.peakColor, "#ffffff", op);

        const float gain = k.num(P.gain, 1.15f);
        const float attack = 1.f - std::max(0.f, std::min(0.99f, k.num(P.smoothing, 0.55f)));
        const float release = 1.f - std::max(0.f, std::min(0.999f, k.num(P.decay, 0.82f)));
        const bool logv = k.flag(P.logScale, true);
        const float bStart = std::max(0.f, std::min(1.f, k.num(P.bandStart, 0.f)));
        const float bEnd = std::max(bStart + 0.001f, std::min(1.f, k.num(P.bandEnd, 1.f)));
        const bool quant = k.flag(P.quantize, true);

        // Dim grid first, one pass, so lit cells paint over it.
        for (int i = 0; i < cols; ++i) {
            for (int j = 0; j < rows; ++j) {
                if (!pushCell(shape, gx + i * pitch, gy + j * pitch, cell, radius, dim)) return;
            }
        }

        for (int i = 0; i < cols; ++i) {
            const float t = cols <= 1 ? 0.f : (float)i / (cols - 1);
            const float tt = logv ? std::pow(t, 1.6f) : t;
            const int band = std::max(0, std::min(kBands - 1,
                (int)((bStart + (bEnd - bStart) * tt) * (kBands - 1) + 0.5f)));
            const float raw = std::max(0.f, std::min(1.f, tiltedBand(band, tiltDb) * gain));
            const float prev = k.heat[i];
            k.heat[i] = prev + (raw - prev) * (raw > prev ? attack : release);
            const float v = k.heat[i];

            // Lit rows from the bottom (row index rows-1 is the floor).
            const float levelF = v * rows;
            const int lit = std::min(rows, (int)levelF);
            const float frac = levelF - (float)lit;
            for (int n = 0; n <= lit && n < rows; ++n) {
                float a = 1.f;
                if (n == lit && !quant) a = frac;          // partial top cell
                if (a <= 0.002f) continue;
                const int j = rows - 1 - n;
                const float f = rows <= 1 ? 0.f : (float)j / (rows - 1);
                Rgba cc = mixRgba(c1, c2, f);
                cc.a *= a;
                if (!pushCell(shape, gx + i * pitch, gy + j * pitch, cell, radius, cc)) return;
            }
        }

        if (k.flag(P.peaks, false)) {
            const float peakWidth = std::max(1.f, k.num(P.peakWidth, 4.f));
            const float peakFall = std::max(0.f, k.num(P.peakFall, 1.1f));
            const float peakDelay = std::max(0.f, k.num(P.peakDelay, 0.f));
            const float peakGap = std::max(0.f, k.num(P.peakGap, 0.f));
            for (int i = 0; i < cols; ++i) {
                const float want = k.heat[i] * rows;
                if (want > k.pk[i]) { k.pk[i] = want; k.ph[i] = 0.f; }
                else {
                    k.ph[i] += dtMs / 1000.f;
                    if (k.ph[i] >= peakDelay) {
                        k.pk[i] = std::max(0.f, k.pk[i] - peakFall * pitch * dtMs / 1000.f);
                    }
                }
                // Clamp against the DRAWN tip (quantised rows sit a whole cell
                // lower than the raw value), never above the grid.
                const float tip = quant ? std::round(k.heat[i] * rows) : k.heat[i] * rows;
                const float ph = std::min(std::max(k.pk[i], tip), (float)rows);
                if (ph <= 0.f) continue;
                const float y = gy + (rows - ph) * pitch - peakGap;
                if (y > gy + gridH) continue;
                emitRect(gx + i * pitch, y, cell,
                         std::min(cell, peakWidth), pk, peakWidth * 0.3f, glow);
            }
        }
    }

    /** Emits one grid cell as a circle or rounded/square rect. */
    bool pushCell(int shape, float x, float y, float size, float radius, const Rgba& c) {
        if (shape == 0) {
            float* cmd = pushCmd(OP_CIRCLE);
            if (!cmd) return false;
            cmd[C_X] = x; cmd[C_Y] = y; cmd[C_W] = size; cmd[C_H] = size;
            cmd[C_P0] = 0.f;
            setColor(cmd, c);
            return true;
        }
        emitRect(x, y, size, size, c, radius, 0.f);
        return true;
    }

    // ---- rays: sunburst spokes ---------------------------------------------
    /**
     * Spokes from the box centre, length driven by the spectrum. Solid when
     * plain, along-spoke gradient when `gradient` is on, and a tapered
     * triangle when `taper` > 0.
     */
    void passRays(Component& k) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const float op = opacityOf(k);
        const float cx = b.x + b.w * 0.5f;
        const float cy = b.y + b.h * 0.5f;
        const float base = std::max(1.f, std::min(b.w, b.h)) * 0.5f;

        const int count = std::max(4, std::min(360, (int)k.num(P.count, 96.f)));
        const float inner = std::max(0.f, std::min(0.95f, k.num(P.innerRadius, 0.25f))) * base;
        const float lenMax = std::max(0.01f, k.num(P.length, 0.5f)) * base;
        const float sw = std::max(0.5f, k.num(P.strokeWidth, 0.004f) * surfH);
        const float taper = std::max(0.f, std::min(1.f, k.num(P.taper, 0.f)));
        const bool mirror = k.flag(P.mirror, false);
        const float a0 = k.num(P.arcStart, 0.f) * kPi / 180.f;
        const float aSpan = std::max(1.f, std::min(360.f, k.num(P.arcSpan, 360.f))) * kPi / 180.f;
        const bool gradient = k.flag(P.gradient, false);

        const float gain = k.num(P.gain, 1.15f);
        const float tiltDb = k.num(P.tilt, 0.f);
        const float smooth = std::max(0.f, std::min(0.95f, k.num(P.smoothing, 0.55f)));
        const float energy = std::max(beatPulse, levelOf(AS_BASS));
        // spin: rev/s; spinBeat adds angular velocity on the beat.
        const float spinAmt = k.num(P.spin, 0.05f) * 2.f * kPi +
                              k.num(P.spinBeat, 0.3f) * energy * 0.9f;
        const float rot = timeMs / 1000.f * spinAmt + a0;
        // pulseAmount scales the inner radius (spokes reach further in).
        const float innerPulse = inner * (1.f - std::max(0.f, std::min(0.9f, k.num(P.pulseAmount, 0.08f))) * energy);

        const Rgba c1 = colorOf(k, P.color, "#00e5ff", op);
        const Rgba c2 = colorOf(k, P.color2, "#ff2d95", op);
        const bool smoothable = smooth > 0.001f;
        if (smoothable && (int)k.wave.size() != count) k.wave.assign(count, 0.f);

        for (int i = 0; i < count; ++i) {
            float t = count <= 1 ? 0.f : (float)i / (count - 1);
            if (mirror) t = 1.f - std::fabs(2.f * t - 1.f);
            const int band = std::max(0, std::min(kBands - 1, (int)(t * (kBands - 1) + 0.5f)));
            const float raw = std::max(0.f, std::min(1.f, tiltedBand(band, tiltDb) * gain));
            if (smoothable) {
                const float prev = k.wave[i];
                k.wave[i] = prev + (raw - prev) * (1.f - smooth);
            }
            const float v = smoothable ? k.wave[i] : raw;

            const float ang = rot + (float)i / count * aSpan;
            const float ca = std::cos(ang), sa = std::sin(ang);
            const float rOut = innerPulse + lenMax * v;
            const float x0 = cx + ca * innerPulse, y0 = cy + sa * innerPulse;
            const float x1 = cx + ca * rOut, y1 = cy + sa * rOut;

            if (taper > 0.001f) {
                // Triangle: wide at the inner radius, a point at the tip.
                const float halfW = sw * 0.5f * (1.f - taper * 0.35f);
                const int at = (int)points.size() / 2;
                if (at + 3 + 2 > kMaxPoints) break;
                pushPoint(x0 - sa * halfW, y0 + ca * halfW);
                pushPoint(x0 + sa * halfW, y0 - ca * halfW);
                pushPoint(x1, y1);
                float* cmd = pushCmd(OP_POLYGON);
                if (!cmd) break;
                cmd[C_P0] = 3.f; cmd[C_P1] = (float)at; cmd[C_P2] = 0.f;
                Rgba bc = gradient ? mixRgba(c1, c2, v) : c1;
                bc.a *= std::max(0.15f, 1.f - taper * 0.4f);
                setColor(cmd, bc);
                continue;
            }

            if (gradient) {
                // 3-point polyline so the along-spoke gradient has a bbox to
                // work with; gradientAngle follows the spoke.
                const float xm = (x0 + x1) * 0.5f, ym = (y0 + y1) * 0.5f;
                const int at = (int)points.size() / 2;
                if (at + 3 + 2 > kMaxPoints) break;
                pushPoint(x0, y0); pushPoint(xm, ym); pushPoint(x1, y1);
                float* cmd = pushCmd(OP_GRADIENT_LINE);
                if (!cmd) break;
                cmd[C_P0] = 3.f; cmd[C_P1] = (float)at; cmd[C_P2] = sw;
                cmd[C_P3] = ang * 180.f / kPi;
                setColor(cmd, c1);
                setColor2(cmd, c2);
                continue;
            }

            float* cmd = pushCmd(OP_LINE);
            if (!cmd) break;
            cmd[C_X] = x0; cmd[C_Y] = y0; cmd[C_W] = x1; cmd[C_H] = y1;
            cmd[C_P0] = sw;
            setColor(cmd, c1);
        }
    }

    // ---- terrain: 3D spectrum mountains ---------------------------------------
    /**
     * A history of spectrum frames drawn as a perspective grid of ridgelines,
     * viewed through an orbiting camera. Each row is ONE stroked polyline out
     * of the shared point pool, so a 72-row terrain is 72 commands rather than
     * thousands of LINE records.
     *
     * Model space: u across frequency (-1..1), w front-to-back (-1..1),
     * v = level * heightScale. Yaw about Y, then pitch about X, then a
     * 1/(z+d) perspective divide. Rows are sorted by post-rotation depth and
     * drawn back to front, because the yaw can pass 90 degrees and flip their
     * order.
     */
    void passTerrain(Component& k, float dtMs) {
        const PropIds& P = PropIds::get();
        const Box b = boxOf(k);
        if (b.w <= 0.f || b.h <= 0.f) return;
        const float op = opacityOf(k);
        if (hist.empty()) return;

        // ---- resolution, clamped against the POINT pool (not the command
        // budget): every row writes `bands` points, and pushPoint() silently
        // drops anything past kMaxPoints, which would shear the geometry.
        int bands = std::max(8, std::min(192, (int)k.num(P.terrainBands, 96.f)));
        int rows = std::max(4, std::min(kHistRows, (int)k.num(P.terrainRows, 72.f)));
        const bool occlude = k.flag(P.occlude, false);
        const int perRow = bands + (occlude ? 2 : 0);
        while (rows * perRow > kMaxPoints - 64 && rows > 4) --rows;
        if (rows * perRow > kMaxPoints - 64) bands = std::max(8, (kMaxPoints - 64) / rows - 2);
        if ((int)k.tsm.size() != rows * bands) k.tsm.assign(rows * bands, 0.f);

        const float gain = k.num(P.gain, 1.3f);
        const float tiltDb = std::max(0.f, k.num(P.tilt, 3.f));
        const bool logv = k.flag(P.logScale, true);
        const float floorDb = std::max(-90.f, std::min(-30.f, k.num(P.floorDb, -70.f)));
        const float hScale = std::max(0.02f, k.num(P.heightScale, 0.45f));
        const float attack = 1.f - std::max(0.f, std::min(0.95f, k.num(P.smoothing, 0.5f)));
        const float release = 1.f - std::max(0.f, std::min(0.99f, k.num(P.decay, 0.8f)));
        const float rowSm = std::max(0.f, std::min(1.f, k.num(P.rowSmooth, 0.25f)));

        // ---- resample the shared history into this component's resolution
        // Row 0 is the NEWEST frame; the buffer is walked backwards from head.
        const int avail = std::min(rows, histFilled);
        for (int r = 0; r < rows; ++r) {
            const int age = r;
            const float* src = nullptr;
            if (age < avail) {
                const int idx = (histHead - 1 - age + kHistRows * 2) % kHistRows;
                src = &hist[(size_t)idx * kBands];
            }
            for (int i = 0; i < bands; ++i) {
                float target = 0.f;
                if (src) {
                    const float t = bands <= 1 ? 0.f : (float)i / (bands - 1);
                    const float p = t * (kBands - 1);
                    const int b0 = std::max(0, std::min(kBands - 1, (int)p));
                    const int b1 = std::min(kBands - 1, b0 + 1);
                    // logScale spreads the low bands across more columns
                    const float tt = logv ? std::pow(t, 1.5f) : t;
                    const float q = tt * (kBands - 1);
                    const int c0 = std::max(0, std::min(kBands - 1, (int)q));
                    const int c1 = std::min(kBands - 1, c0 + 1);
                    (void)b0; (void)b1;
                    const float f = q - (float)c0;
                    const float v = src[c0] + (src[c1] - src[c0]) * f;
                    const float tilted = v * bandTilt(c0, tiltDb) * gain;
                    // dB floor: quiet detail lifts the floor noise into view.
                    const float dbv = 20.f * std::log10(std::max(tilted, 1e-5f));
                    target = std::max(0.f, std::min(1.f, (dbv - floorDb) / (-floorDb)));
                }
                float& cell = k.tsm[r * bands + i];
                cell += (target - cell) * (target > cell ? attack : release);
            }
        }
        if (rowSm > 0.001f) {
            // Calm jitter by blending each row with its neighbours in time.
            for (int r = 1; r < rows - 1; ++r) {
                const float* prev = &k.tsm[(r - 1) * bands];
                float* cur = &k.tsm[r * bands];
                const float* next = &k.tsm[(r + 1) * bands];
                for (int i = 0; i < bands; ++i) {
                    const float avg = (prev[i] + next[i]) * 0.5f;
                    cur[i] += (avg - cur[i]) * rowSm;
                }
            }
        }

        // ---- camera --------------------------------------------------------
        // Rotation is stateful (not wall-clock derived) so pause and seek
        // behave and the output is deterministic for (time, audio).
        const float playing = vars.get("playing").empty() || vars.get("playing") == "1" ? 1.f : 0.f;
        const int mode = std::max(0, std::min(4, (int)k.num(P.rotateMode, 1.f)));
        const float energy = std::max(beatPulse, levelOf(AS_BASS));
        if (playing > 0.5f) k.camT += dtMs / 1000.f;

        // Beat edge -> yaw impulse, then spring decay.
        if (beatPulse >= 0.99f && k.prevBeat < 0.5f) k.kickVel += k.num(P.yawBeat, 12.f) * 0.6f;
        k.prevBeat = beatPulse;
        const float kd = std::max(0.5f, std::min(0.98f, k.num(P.kickDecay, 0.9f)));
        k.kickVel += (0.f - k.kickVel) * (1.f - kd);
        k.kick += k.kickVel * dtMs / 1000.f;
        if (std::fabs(k.kick) < 1e-4f) k.kick = 0.f;

        const float yaw0 = k.num(P.yawStart, 0.f) * kPi / 180.f;
        const float yawSpeed = k.num(P.yawSpeed, 12.f) * kPi / 180.f;
        float yaw = yaw0;
        if (mode == 1 || mode == 4) {
            yaw += k.camT * yawSpeed;
        } else if (mode == 2) {
            const float per = std::max(2.f, k.num(P.swayPeriod, 16.f));
            const float ph = std::sin(k.camT * 2.f * kPi / per);
            yaw += ph * k.num(P.swayRange, 40.f) * kPi / 180.f;
        }
        if (mode == 3 || mode == 4) yaw += k.kick;
        if (mode == 3 && mode != 4) yaw += k.kick;
        // Wrap so a long spin cannot drift into float noise.
        yaw = std::fmod(yaw, 2.f * kPi);
        if (yaw > kPi) yaw -= 2.f * kPi;
        if (yaw < -kPi) yaw += 2.f * kPi;
        k.yaw = yaw;

        if (k.flag(P.avoidEdgeOn, true)) {
            // Ease through the edge-on angles instead of dwelling on them,
            // where the grid collapses to a line.
            const float deg = std::fabs(yaw) * 180.f / kPi;
            const float f = std::fmod(deg, 360.f);
            const float edge = std::min(std::fabs(f - 90.f), std::fabs(f - 270.f));
            const float t = std::max(0.f, std::min(1.f, (20.f - edge) / 20.f));
            yaw *= (1.f - 0.85f * t);          // slow down, do not stall
        }

        const float pitchMax = 85.f * kPi / 180.f;
        float pitch = std::max(0.f, std::min(pitchMax, k.num(P.pitch, 35.f) * kPi / 180.f));
        pitch -= k.num(P.pitchBass, 4.f) * kPi / 180.f * energy;
        pitch = std::max(0.f, std::min(pitchMax, pitch));
        float dist = std::max(0.5f, k.num(P.distance, 2.2f));
        dist -= k.num(P.zoomBeat, 0.06f) * beatPulse;
        dist = std::max(0.35f, dist);
        const float lookY = k.num(P.lookY, 0.05f);
        const float fovRad = std::max(10.f, std::min(140.f, k.num(P.fov, 55.f))) * kPi / 180.f;
        const float focal = 0.5f * std::min(b.w, b.h) / std::max(0.15f, std::tan(fovRad * 0.5f));
        const float cx = b.x + b.w * 0.5f;
        const float cy = b.y + b.h * 0.5f;
        const float roll = k.flag(P.rotateAxis, false) ? k.num(P.roll, 0.f) * kPi / 180.f : 0.f;

        // ---- project -------------------------------------------------------
        const float taper = std::max(0.f, std::min(0.9f, k.num(P.widthTaper, 0.35f)));
        // Depth convention: wr = -1 is NEAREST the viewer, +1 is farthest,
        // because the perspective divide is s = 1/(z + distance) — a larger z
        // must mean farther for the near rows to scale up. flow 0 feeds the
        // newest row to the near end.
        const float away = k.num(P.flow, 0.f) >= 0.5f ? -1.f : 1.f;
        const float cp = std::cos(pitch), sp = std::sin(pitch);
        const float cyw = std::cos(yaw), syw = std::sin(yaw);

        // Row depth for sorting, including the row's own height so tall rows
        // still order correctly once pitch tilts the plane.
        float depth[kHistRows];
        for (int r = 0; r < rows; ++r) {
            const float ageT = rows <= 1 ? 0.f : (float)r / (rows - 1);
            const float wr = away * (-1.f + 2.f * ageT);
            float mean = 0.f;
            for (int i = 0; i < bands; ++i) mean += k.tsm[r * bands + i];
            mean = bands > 0 ? (mean / bands) * hScale : 0.f;
            depth[r] = -mean * sp + wr * cyw * cp;
        }
        int order[kHistRows];
        for (int r = 0; r < rows; ++r) order[r] = r;
        std::sort(order, order + rows, [&](int a, int c) {
            return depth[a] > depth[c];          // farthest (largest z) first
        });

        const float strokeW = std::max(0.5f, k.num(P.strokeWidth, 0.0015f) * surfH);
        const float glowAll = std::max(0.f, k.num(P.glow, 0.f));
        const float glowTall = std::max(0.f, k.num(P.heightGlow, 0.f));
        const float fade = std::max(0.f, std::min(1.f, k.num(P.depthFade, 0.5f)));
        const int colorBy = std::max(0, std::min(2, (int)k.num(P.colorBy, 0.f)));
        const bool useRamp = k.flag(P.gradient, false);
        const Rgba c1 = colorOf(k, P.color, "#ffffff", op);
        const Rgba c2 = colorOf(k, P.color2, "#22e1ff", op);
        const Rgba bg = roleColor(0, op);

        // Clip to the box so rotated corners never leak over neighbours.
        float* clip = pushCmd(OP_CLIP_PUSH);
        if (clip) {
            clip[C_X] = b.x; clip[C_Y] = b.y; clip[C_W] = b.w; clip[C_H] = b.h;
            clip[C_P0] = 0.f;
            setColor(clip, Rgba{1, 1, 1, 1});
        }

        for (int oi = 0; oi < rows; ++oi) {
            const int r = order[oi];
            const float ageT = rows <= 1 ? 0.f : (float)r / (rows - 1);
            const float wr = away * (-1.f + 2.f * ageT);
            // Far rows get narrower on top of the perspective narrowing.
            const float uScale = 1.f - taper * ageT;
            float peak = 0.f;
            float firstX = 0.f, lastX = 0.f;
            const int at = (int)points.size() / 2;
            if (at + bands + 2 > kMaxPoints) break;
            for (int i = 0; i < bands; ++i) {
                const float u = ((float)i / (bands - 1)) * 2.f - 1.f;
                const float v = k.tsm[r * bands + i] * hScale;
                if (v > peak) peak = v;
                // yaw about Y (z grows AWAY from the viewer, see the depth note above)
                const float x1 = u * uScale * cyw + wr * syw;
                const float z1 = -u * uScale * syw + wr * cyw;
                // pitch about X. With z away-from-viewer the rotation is
                // y' = y cos + z sin, z' = -y sin + z cos — which puts the NEAR
                // rows low on screen and the far ones rising to the horizon.
                const float y2 = v * cp + z1 * sp;
                const float z2 = -v * sp + z1 * cp;
                const float s = 1.f / std::max(0.05f, z2 + dist);
                float X = x1 * s * focal;
                float Y = (y2 - lookY) * s * focal;
                if (roll != 0.f) {
                    const float rx = X * std::cos(roll) - Y * std::sin(roll);
                    const float ry = X * std::sin(roll) + Y * std::cos(roll);
                    X = rx; Y = ry;
                }
                if (i == 0) firstX = X;
                lastX = X;
                pushPoint(cx + X, cy - Y);
            }
            if (occlude) {
                // Fill down to the floor PLANE at this row's depth, so nearer
                // rows hide the ones behind them (hidden-line removal).
                const float zf = wr * cyw;
                const float yf = zf * sp;
                const float z2f = zf * cp;
                const float sf = 1.f / std::max(0.05f, z2f + dist);
                const float floorY = cy - (yf - lookY) * sf * focal;
                pushPoint(cx + lastX, floorY);
                pushPoint(cx + firstX, floorY);
                float* fill = pushCmd(OP_POLYGON);
                if (fill) {
                    fill[C_P0] = (float)(bands + 2);
                    fill[C_P1] = (float)at;
                    fill[C_P2] = 0.f;
                    setColor(fill, bg);
                }
            }
            // Colour: depth (row position), height (this row's peak) or age.
            float t = 0.f;
            if (colorBy == 1) t = peak / std::max(0.001f, hScale);
            else if (colorBy == 2) t = 1.f - ageT;
            else t = ageT;
            t = std::max(0.f, std::min(1.f, t));
            Rgba rc = useRamp ? mixRgba(c1, c2, t) : c1;
            // Far rows lose opacity.
            const float far = ageT;
            rc.a *= (1.f - fade * far) * (r < avail ? 1.f : 0.6f);
            float* stroke = pushCmd(OP_POLYGON);
            if (!stroke) break;
            stroke[C_P0] = (float)bands;
            stroke[C_P1] = (float)at;
            // Glow is the expensive part, so it goes on the near rows and on
            // the tall peaks rather than on all 72.
            float gl = glowAll;
            if (glowTall > 0.f && (oi < 8 || peak > hScale * 0.7f)) gl = glowTall;
            stroke[C_P2] = strokeW;
            setColor(stroke, rc);
        }

        if (k.flag(P.floorGrid, false)) {
            const float fo = std::max(0.f, std::min(0.5f, k.num(P.floorOpacity, 0.12f))) * op;
            Rgba fc = colorOf(k, P.floorColor, "#ffffff", fo);
            for (int g = -2; g <= 2; ++g) {
                const int at = (int)points.size() / 2;
                if (at + 2 > kMaxPoints) break;
                const float w0 = (float)g / 3.f;
                // Floor lines run front-to-back at a fixed frequency column,
                // projected through the same camera as the rows.
                auto floorPt = [&](float wr) {
                    const float x1 = w0 * cyw + wr * syw;
                    const float z1 = -w0 * syw + wr * cyw;
                    const float y2 = z1 * sp;
                    const float z2 = z1 * cp;
                    const float s = 1.f / std::max(0.05f, z2 + dist);
                    pushPoint(cx + x1 * s * focal, cy - (y2 - lookY) * s * focal);
                };
                floorPt(-1.f);
                floorPt(1.f);
                float* line = pushCmd(OP_POLYGON);
                if (!line) break;
                line[C_P0] = 2.f; line[C_P1] = (float)at; line[C_P2] = strokeW;
                setColor(line, fc);
            }
        }

        float* pop = pushCmd(OP_CLIP_POP);
        (void)pop;
    }

    // ---- dispatch + frame -------------------------------------------------
    void renderComponent(Component& k, float dtMs) {
        k.pulse = beatPulse;
        // Hidden components keep their preset/engine index (so live edits stay
        // aimed correctly) but emit nothing — the layers eye toggle sets this.
        if (k.num(PropIds::get().hidden, 0.f) >= 0.5f) return;
        switch (k.type) {
            case CT_BACKGROUND: passBackground(k); break;
            case CT_SPECTRUM:   passSpectrum(k, dtMs); break;
            case CT_LINE:       passLine(k, dtMs); break;
            case CT_TEXT:       passText(k, dtMs); break;
            case CT_IMAGE:      passImage(k); break;
            case CT_SHAPE:      passShape(k); break;
            case CT_METER:      passMeter(k); break;
            case CT_BEAT:       passBeat(k, dtMs); break;
            case CT_BEAT_GLOW:  passBeatGlow(k, dtMs); break;
            case CT_COVER:      passCover(k, dtMs); break;
            case CT_ORB:        passOrb(k, dtMs); break;
            case CT_PROGRESS:   passProgress(k); break;
            case CT_RADIAL_LINE: passRadialLine(k); break;
            case CT_PARTICLES:  passParticles(k, dtMs); break;
            case CT_DOT_MATRIX: passDotMatrix(k, dtMs); break;
            case CT_RAYS:       passRays(k); break;
            case CT_TERRAIN:    passTerrain(k, dtMs); break;
            default: break;
        }
    }

    void frame(float dtMs) {
        if (!(dtMs > 0.f)) dtMs = 16.7f;
        if (dtMs > 100.f) dtMs = 100.f;
        timeMs += dtMs;

        analyze(dtMs);

        // Advance the shared spectrum history once per frame, at the fastest
        // interval any terrain component asked for.
        float fastest = 1e9f;
        for (const Component& c : comps) {
            if (c.type != CT_TERRAIN) continue;
            fastest = std::min(fastest, std::max(5.f, c.num(PropIds::get().rowIntervalMs, 45.f)));
        }
        if (fastest < 1e8f) pushHistory(dtMs, fastest);

        cmds.clear();
        points.clear();
        poolLen = 0;

        if (comps.empty()) {
            float* c = pushCmd(OP_CLEAR);
            if (c) setColor(c, Rgba{0.f, 0.f, 0.f, 1.f});
            return;
        }
        for (Component& k : comps) renderComponent(k, dtMs);

        // Silence decays naturally until the host commits new samples.
        std::fill(inBuf.begin(), inBuf.end(), 0.f);
        if ((int)pool.size() < poolLen + 1) pool.resize(poolLen + 1);
        pool[poolLen] = '\0';
    }

    void clearAll() {
        comps.clear();
        cmds.clear();
        points.clear();
        pool.clear();
        poolLen = 0;
        measures.clear();
        images.clear();
        vars = VarTable();
        publishDefaults();
        bands.assign(kBands, 0.f);
        prevBands.assign(kBands, 0.f);
        // Spectrum history belongs to the "now playing" timeline, so a full
        // reset drops it too; a preset change does not.
        initHistory();
        rms = peak = bass = mid = treb = 0.f;
        beatPulse = 0.f;
        beatPhase = 0.f;
        bpm = 120.f;
        bassAvg = 0.06f;
        fluxAvg = 0.3f;
        lastBeatMs = -1e9;
        timeMs = 0.0;
        std::fill(inBuf.begin(), inBuf.end(), 0.f);
    }
};

Engine& E() {
    static Engine engine = [] {
        Engine e;
        e.init();
        return e;
    }();
    return engine;
}

}  // namespace

// ===========================================================================
// Public C ABI
// ===========================================================================
VZE_API int vze_cmd_stride() { return CMD_STRIDE; }
VZE_API int vze_band_count() { return kBands; }
VZE_API int vze_audio_window() { return kFftSize; }
VZE_API int vze_type_count() { return (int)CT_COUNT; }
VZE_API int vze_version_code() { return 10000; }
VZE_API const char* vze_version() { return "vze 1.0.0"; }

VZE_API int vze_type_id(const char* name, int len) { return typeIdOf(name, len); }
VZE_API int vze_prop_id(const char* name, int len) { return propIdOf(name, len); }
VZE_API int vze_op_id(const char* name, int len) { return opIdOf(name, len); }
VZE_API const char* vze_type_name(int type) {
    if (type < 0 || type >= (int)CT_COUNT) return "";
    return kTypeNames[type];
}

VZE_API void vze_reset() { E().clearAll(); }
VZE_API void vze_set_surface(int w, int h) {
    E().surfW = std::max(1, w);
    E().surfH = std::max(1, h);
}
VZE_API void vze_set_audio_rate(int sampleRate) {
    E().sampleRate = std::max(8000, sampleRate);
    E().recomputeBands();
}

VZE_API float* vze_audio_buffer() { return E().inBuf.data(); }
VZE_API void vze_audio_commit(int samples) {
    Engine& e = E();
    if (samples < 0) samples = 0;
    if (samples > kFftSize) samples = kFftSize;
    for (int i = samples; i < kFftSize; ++i) e.inBuf[i] = 0.f;
}
VZE_API float vze_level(int source) { return E().levelOf(source); }
VZE_API float vze_band(int index) {
    Engine& e = E();
    if (index < 0 || index >= kBands) return 0.f;
    return e.bands[index];
}
VZE_API float vze_beat_phase() { return E().beatPhase; }

VZE_API void vze_var_set(const char* name, int nameLen, const char* value, int valueLen) {
    if (!name) return;
    std::string k(name, nameLen < 0 ? std::strlen(name) : (size_t)nameLen);
    std::string v = value ? std::string(value, valueLen < 0 ? std::strlen(value) : (size_t)valueLen) : std::string();
    E().vars.setText(k, v);
}
VZE_API void vze_var_set_number(const char* name, int nameLen, float value) {
    if (!name) return;
    std::string k(name, nameLen < 0 ? std::strlen(name) : (size_t)nameLen);
    E().vars.setNumber(k, value);
}
VZE_API const char* vze_var_get(const char* name, int nameLen) {
    static std::string buf;
    if (!name) return "";
    std::string k(name, nameLen < 0 ? std::strlen(name) : (size_t)nameLen);
    buf = E().vars.get(k);
    return buf.c_str();
}

VZE_API void vze_scene_clear() { E().comps.clear(); }
VZE_API int vze_scene_add(int typeId) {
    if (typeId < 0 || typeId >= (int)CT_COUNT) return -1;
    Engine& e = E();
    e.comps.emplace_back();
    e.comps.back().type = typeId;
    return (int)e.comps.size() - 1;
}
VZE_API void vze_scene_remove(int index) {
    Engine& e = E();
    if (index < 0 || index >= (int)e.comps.size()) return;
    e.comps.erase(e.comps.begin() + index);
}
VZE_API void vze_scene_move(int index, int to) {
    Engine& e = E();
    const int n = (int)e.comps.size();
    if (index < 0 || index >= n) return;
    to = std::max(0, std::min(n - 1, to));
    if (to == index) return;
    const Component moved = e.comps[index];
    e.comps.erase(e.comps.begin() + index);
    e.comps.insert(e.comps.begin() + to, moved);
}
VZE_API void vze_scene_set_num(int index, int propId, float value) {
    Engine& e = E();
    if (index < 0 || index >= (int)e.comps.size() || propId < 0) return;
    e.comps[index].nums[propId] = value;
}
VZE_API float vze_scene_get_num(int index, int propId) {
    Engine& e = E();
    if (index < 0 || index >= (int)e.comps.size() || propId < 0) return 0.f;
    return e.comps[index].num(propId, 0.f);
}
VZE_API void vze_scene_set_str(int index, int propId, const char* value, int len) {
    Engine& e = E();
    if (index < 0 || index >= (int)e.comps.size() || propId < 0) return;
    e.comps[index].strs[propId] =
        value ? std::string(value, len < 0 ? std::strlen(value) : (size_t)len) : std::string();
}
VZE_API int vze_scene_count() { return (int)E().comps.size(); }
VZE_API int vze_scene_type(int index) {
    Engine& e = E();
    if (index < 0 || index >= (int)e.comps.size()) return -1;
    return e.comps[index].type;
}

VZE_API void vze_image_set(int id, float naturalW, float naturalH) {
    E().images[id] = std::make_pair(naturalW, naturalH);
}
VZE_API void vze_image_clear() { E().images.clear(); }
VZE_API void vze_cover_set(int imgId) { E().coverId = imgId; }
VZE_API int  vze_cover_get() { return E().coverId; }

VZE_API void vze_measure_put(int strId, float width) {
    if (strId >= 0) E().measures[strId] = width;
}
VZE_API float vze_measure_get(int strId) {
    Engine& e = E();
    auto it = e.measures.find(strId);
    return it == e.measures.end() ? 0.f : it->second;
}

VZE_API void vze_frame(float dtMs) { E().frame(dtMs); }
VZE_API int vze_cmd_count() { return (int)(E().cmds.size() / CMD_STRIDE); }
VZE_API float* vze_cmd_data() { return E().cmds.data(); }
VZE_API int vze_cmd_capacity() { return kMaxCmds; }
VZE_API int vze_point_count() { return (int)(E().points.size() / 2); }
VZE_API float* vze_point_data() { return E().points.data(); }
VZE_API const char* vze_pool_data() { return E().pool.data(); }
VZE_API int vze_pool_len() { return E().poolLen; }
VZE_API int vze_pool_capacity() { return kPoolCap; }
};
