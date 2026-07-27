let w = 330, h = 120, d = 20, r = 60;
const BOX_BEVEL = 3; // bevel size/thickness used for the extruded box model below

const TIMELINE_TRACK_PX = 535;

let boxPreset;
let isAnimating = false;
let isBoxFinished = false;
let boxPlayIndex = 0;
let boxAnimStart = 0;
let boxHoldStart = 0;
let boxIsHolding = false;
let playbackClockStart = 0;

let boxPreviewStepIndex = 0;
let cursorPreviewStepIndex = 0;

// Tracks whichever step thumbnail the user last clicked (box or cursor), so
// that pressing Apply on either preset's textarea re-seeks back to that same
// frame using the freshly-applied values, instead of resetting to the idle
// default view. Cleared whenever playback starts (toggleBox/toggleCursor).
let lastSelectedStepKind = null; // "box" | "cursor" | null
let lastSelectedStepIndex = 0;

// Unified seeking state — replaces the old isBoxPreviewMode / isCursorPreviewMode split.
// When isSeeking is true, both the box and the cursor render whatever their
// interpolated state would be at seekElapsedMs on the shared timeline.
let isSeeking = false;
let seekElapsedMs = 0;

let rawBoxPreset = [];
let defaultBoxPresetRaw = [];

let masterPath = [];
let presets = [];
// A "run" is a maximal chain of consecutive cursor presets connected by
// hold === 0 on the arriving preset. Easing is applied once across the
// whole run instead of once per leg, so waypoints in the middle of a run
// don't decelerate to near-zero speed (which reads as an unwanted pause).
let cursorRuns = [];
let isCursorPlaying = false;
let isCursorFinished = false;
let cursorPlayIndex = 0;
let cursorStartTime = 0;
let cursorHoldStart = 0;
let cursorIsHolding = false;

let liveCursorAngleRef = { value: null };
let cursorPlaybackClockStart = 0;
const ANGLE_SMOOTHING = 0.18;


let thumbBuffer;
let thumbCursorAngleRef = { value: null };
const THUMB_SIZE = 600; // same resolution as the real canvas, so thumbnails are pixel-accurate; scaled down visually via <img> width/height

let boxTimelineBar, cursorTimelineBar;
let boxSceneLabel, cursorSceneLabel;

let selectedComponent = "box"; // "box" | "cursor" — determines which step numeric keys control

// LOAD DATA
let initialBoxPresetJson = [];
let rawCursorPresets = [];

let txtInputEl, colorPickerEl, chkVisualizeEl, chkShowPathEl;
let sldAmbientEl;
let sldDir1IntensityEl, sldDir1XEl, sldDir1YEl, sldDir1ZEl;
let sldDir2IntensityEl, sldDir2XEl, sldDir2YEl, sldDir2ZEl;
let sldGlassAlphaEl, sldGlassShininessEl, sldEmissiveEl;
let boxStepBtnContainerEl, boxStepInfoDivEl, cursorStepBtnContainerEl, cursorStepInfoDivEl;
let txtBoxPresetEl, boxPresetErrorDivEl, txtCursorPresetsEl, cursorPresetErrorDivEl;
let timelineContainerDivEl;
let sharedPlayhead;
let cursorTypeSelectEl;

// BOX MODEL
// The box is now an extruded, beveled rounded-rect built the same way the
// "Generate" button demo builds its geometry: BezierPath traces the rounded
// rect outline, then smoothExtrude.js's extrudeContours() extrudes+bevels it
// into a p5.Geometry. A Material Hook shader (buildMaterialShader) gives it
// a glassy edge highlight instead of the old flat specularMaterial() look.
// Both are built once in setup() since w/h/d/r/BOX_BEVEL are fixed constants.
let boxModel;
let glassShader;

// The glassShader Material Hook (built once below) reads this every frame to
// drive its edge-emissive rim-light strength. Referencing an outer JS
// variable inside a Material Hook makes it a live uniform that p5 re-reads
// before each draw — same mechanism the reference sketch uses via
// `sliderEmissiveIntensity.value()`. We use a getter function for the same
// reason the reference does: a function call is the pattern known to work.
let currentEmissiveIntensity = 1;
function getEmissiveIntensity() {
  return currentEmissiveIntensity;
}

// TEXT-ON-FACE TEXTURE
// Instead of drawing text() directly onto the WEBGL box face (which reads as a
// flat, faceted overlay), we render the label into an offscreen 2D graphics
// buffer once, then texture a plane with it — same approach as rendering text
// onto a p5.Graphics canvas and mapping it onto a plane() in front of the box.
let textTexture;
let lastRenderedText = null;
const TEXT_TEX_SCALE = 3; // supersample the texture so text stays crisp

function updateTextTexture(str) {
  if (!textTexture) return;
  textTexture.clear();
  textTexture.background(0, 0); // transparent
  textTexture.noStroke();
  textTexture.fill(255);
  textTexture.textAlign(CENTER, CENTER);
  textTexture.textFont(font);
  textTexture.textSize(40 * TEXT_TEX_SCALE);
  textTexture.text(str, textTexture.width / 2, textTexture.height / 2);
  lastRenderedText = str;
}

function lerpAngle(current, target, amt) {
  let diff = ((((target - current + PI) % TWO_PI) + TWO_PI) % TWO_PI) - PI;
  return current + diff * amt;
}

const DIR_LOOKAHEAD = 4;
function pathTangentAt(pathIndex) {
  if (masterPath.length === 0) return { dx: 0, dy: 0 };
  let behind = masterPath[constrain(pathIndex - DIR_LOOKAHEAD, 0, masterPath.length - 1)];
  let ahead = masterPath[constrain(pathIndex + DIR_LOOKAHEAD, 0, masterPath.length - 1)];
  return { dx: ahead.x - behind.x, dy: ahead.y - behind.y };
}

function normalizeBoxPreset(p) {
  p = p || {};
  return {
    rotX: typeof p.rotX === "number" ? p.rotX : 0,
    rotY: typeof p.rotY === "number" ? p.rotY : 0,
    rotZ: typeof p.rotZ === "number" ? p.rotZ : 0,
    zoom: typeof p.zoom === "number" ? p.zoom : 1000,
    // Ambient
    ambientIntensity: typeof p.ambientIntensity === "number" ? p.ambientIntensity : 50,
    // Directional light 1 (intensity + normalized-ish direction vector)
    dir1Intensity: typeof p.dir1Intensity === "number" ? p.dir1Intensity : 255,
    dir1X: typeof p.dir1X === "number" ? p.dir1X : 0,
    dir1Y: typeof p.dir1Y === "number" ? p.dir1Y : 1,
    dir1Z: typeof p.dir1Z === "number" ? p.dir1Z : -1,
    // Directional light 2
    dir2Intensity: typeof p.dir2Intensity === "number" ? p.dir2Intensity : 255,
    dir2X: typeof p.dir2X === "number" ? p.dir2X : -1,
    dir2Y: typeof p.dir2Y === "number" ? p.dir2Y : 0.5,
    dir2Z: typeof p.dir2Z === "number" ? p.dir2Z : -0.2,
    // Glass material
    glassAlpha: typeof p.glassAlpha === "number" ? p.glassAlpha : 100,
    glassShininess: typeof p.glassShininess === "number" ? p.glassShininess : 200,
    emissiveIntensity: typeof p.emissiveIntensity === "number" ? p.emissiveIntensity : 1,
    ms: typeof p.ms === "number" ? p.ms : 0,
    hold: typeof p.hold === "number" ? p.hold : 0,
  };
}

// Reads the current values off the lighting sliders into a plain object
// shaped like a box preset entry's lighting fields. Used as the "manual
// override" source when nothing is animating/seeking (see draw()'s idle
// branch and computeBoxValueAtElapsed()'s counterparts).
function readLightSliders() {
  return {
    ambientIntensity: Number(sldAmbientEl.value),
    dir1Intensity: Number(sldDir1IntensityEl.value),
    dir1X: Number(sldDir1XEl.value),
    dir1Y: Number(sldDir1YEl.value),
    dir1Z: Number(sldDir1ZEl.value),
    dir2Intensity: Number(sldDir2IntensityEl.value),
    dir2X: Number(sldDir2XEl.value),
    dir2Y: Number(sldDir2YEl.value),
    dir2Z: Number(sldDir2ZEl.value),
    glassAlpha: Number(sldGlassAlphaEl.value),
    glassShininess: Number(sldGlassShininessEl.value),
    emissiveIntensity: Number(sldEmissiveEl.value),
  };
}

// Pushes a box-preset-shaped value's lighting fields back onto the sliders,
// so the UI always reflects whatever frame is currently being displayed.
function syncLightSlidersFrom(v) {
  sldAmbientEl.value = v.ambientIntensity;
  sldDir1IntensityEl.value = v.dir1Intensity;
  sldDir1XEl.value = v.dir1X;
  sldDir1YEl.value = v.dir1Y;
  sldDir1ZEl.value = v.dir1Z;
  sldDir2IntensityEl.value = v.dir2Intensity;
  sldDir2XEl.value = v.dir2X;
  sldDir2YEl.value = v.dir2Y;
  sldDir2ZEl.value = v.dir2Z;
  sldGlassAlphaEl.value = v.glassAlpha;
  sldGlassShininessEl.value = v.glassShininess;
  sldEmissiveEl.value = v.emissiveIntensity;
}

function buildBoxPresetFromRaw(raw) {
  return raw.map(normalizeBoxPreset);
}

function normalizeRawCursorPreset(p) {
  return {
    id: p.id,
    pathIndex: typeof p.pathIndex === "number" ? p.pathIndex : 0,
    scale: typeof p.scale === "number" ? p.scale : 1,
    angleTwist: typeof p.angleTwist === "number" ? p.angleTwist : 0,
    rotX: typeof p.rotX === "number" ? p.rotX : 0,
    rotY: typeof p.rotY === "number" ? p.rotY : 0,
    rotZ: typeof p.rotZ === "number" ? p.rotZ : 0,
    ms: typeof p.ms === "number" ? p.ms : 0,
    hold: typeof p.hold === "number" ? p.hold : 0,
    cameraZoom: typeof p.cameraZoom === "boolean" ? p.cameraZoom : false,
  };
}

function buildCursorPresetsFromRaw(raw) {
  return raw.map((p) => {
    let norm = normalizeRawCursorPreset(p);
    let pathIndex = constrain(norm.pathIndex, 0, Math.max(0, masterPath.length - 1));
    let pt = masterPath[pathIndex] || { x: 0, y: 0 };
    return { ...norm, pathIndex, x: pt.x, y: pt.y };
  });
}

// A "run" is a maximal chain of consecutive presets connected by hold === 0
// on the *arriving* preset. Easing is applied once across the whole run,
// not per-segment, so waypoints in the middle of a run don't decelerate to zero.
function computeCursorRuns(presetArr) {
  let runs = [];
  let i = 0;
  while (i < presetArr.length - 1) {
    let start = i;
    let totalMs = 0;
    while (i < presetArr.length - 1) {
      totalMs += presetArr[i + 1].ms;
      i++;
      if (presetArr[i].hold > 0 || i >= presetArr.length - 1) break;
    }
    runs.push({ startIndex: start, endIndex: i, totalMs });
  }
  return runs;
}

const WAYPOINT_LINGER = 0.6;

// Blends a leg's raw linear progress with the currently selected easing
// curve (from the Easing dropdown) by WAYPOINT_LINGER.
function applyWaypointEase(t) {
  let eased = applyEasing(t);
  return lerp(t, eased, WAYPOINT_LINGER);
}

// Given a run and an elapsed time measured from the run's start, returns
// which leg (p1 -> p2) we're in and the eased t within that leg. Each leg
// is located using linear (real) time, and gets the actual selected easing
// curve applied to just itself, blended with linear via WAYPOINT_LINGER so
// motion stays continuous (non-zero velocity) through interior waypoints
// instead of hard-stopping at every one of them.
function sampleRun(run, presetArr, elapsedInRun) {
  let clamped = constrain(elapsedInRun, 0, run.totalMs);
  let runFinished = elapsedInRun >= run.totalMs;

  let acc = 0;
  for (let idx = run.startIndex; idx < run.endIndex; idx++) {
    let legMs = presetArr[idx + 1].ms;
    if (clamped <= acc + legMs || idx === run.endIndex - 1) {
      let legT = legMs > 0 ? (clamped - acc) / legMs : 1;
      legT = constrain(legT, 0, 1);
      legT = applyWaypointEase(legT);
      return { p1: presetArr[idx], p2: presetArr[idx + 1], t: legT, runFinished };
    }
    acc += legMs;
  }
  // fallback (shouldn't hit, but keeps things defined)
  let lastIdx = run.endIndex - 1;
  return { p1: presetArr[lastIdx], p2: presetArr[run.endIndex], t: 1, runFinished: true };
}

// Finds which run (if any) a given preset index belongs to, i.e. the run
// whose startIndex <= index < endIndex.
function findRunForIndex(runs, index) {
  for (let r of runs) {
    if (index >= r.startIndex && index < r.endIndex) return r;
  }
  return null;
}

// How much time (ms) has already elapsed *within this run* before the leg
// starting at currentIndex began — needed because the run's easing needs
// continuous elapsed-in-run time, not just the current leg's own elapsed time.
function runElapsedOffset(run, presetArr, currentIndex) {
  let offset = 0;
  for (let idx = run.startIndex; idx < currentIndex; idx++) {
    offset += presetArr[idx + 1].ms;
  }
  return offset;
}

async function setup() {
  // p5 2.0+ supports async setup(), so assets can be awaited directly here
  // instead of using the older preload() lifecycle function.
  font = await loadFont("Roboto-Regular.ttf");

  let cnv = createCanvas(600, 600, WEBGL);
  document.getElementById("canvas-container").appendChild(cnv.elt);

  // Build the box geometry: trace a rounded-rect outline with BezierPath
  // (same w/h/r dimensions the box always used), then extrude+bevel it via
  // smoothExtrude.js's extrudeContours(). Wrapped in a block so the local
  // path-building variables (k, controlDist, pts, etc.) don't leak globally.
  {
    const k = 0.552284749831; // https://stackoverflow.com/a/27863181
    const controlDist = r * k;
    let path = BezierPath.create([
      { pt: createVector(-w / 2 + r, -h / 2) },
      { pt: createVector(w / 2 - r, -h / 2), right: createVector(w / 2 - r + controlDist, -h / 2) },
      { left: createVector(w / 2, -controlDist), pt: createVector(w / 2, 0), right: createVector(w / 2, controlDist) },
      { left: createVector(w / 2 - r + controlDist, h / 2), pt: createVector(w / 2 - r, h / 2) },
      { pt: createVector(-w / 2 + r, h / 2), right: createVector(-w / 2 + r - controlDist, h / 2) },
      { left: createVector(-w / 2, controlDist), pt: createVector(-w / 2, 0), right: createVector(-w / 2, -controlDist) },
      { left: createVector(-w / 2 + r - controlDist, -h / 2), pt: createVector(-w / 2 + r, -h / 2) },
    ]);
    const numPts = ceil(path.getTotalLength() / 2);
    const pts = [];
    for (let i = 0; i < numPts; i++) {
      const pt = path.getPointAtLength(map(i, 0, numPts, 0, path.getTotalLength()));
      pts.push(createVector(pt.x, pt.y));
    }
    boxModel = extrudeContours([pts], { dist: d, bevel: BOX_BEVEL });
  }

  // Glass-look Material Hook shader: dims alpha and adds a fresnel-style
  // emissive highlight based on how much a surface faces the camera vs. its
  // edges, giving the box the same glassy rim-light look as the button demo.
  glassShader = buildMaterialShader(() => {
    pixelInputs.begin();
    pixelInputs.color.a *= lerp(1 - abs(pixelInputs.normal.z), 1, 0.5);
    let emMult = getEmissiveIntensity();
    pixelInputs.emissiveMaterial += [emMult, emMult, emMult] * pow(1 - abs(pixelInputs.normal.z), 2);
    pixelInputs.end();
  });

  await initCursorTypes(); // from cursor-types.js — samples hand SVG points, precomputes tip angles (awaited in case it loads/parses SVG data asynchronously)

  rawBoxPreset = initialBoxPreset.map(normalizeBoxPreset);
  boxPreset = buildBoxPresetFromRaw(rawBoxPreset);
  defaultBoxPresetRaw = JSON.parse(JSON.stringify(rawBoxPreset));

  textFont(font);

  thumbBuffer = createGraphics(THUMB_SIZE, THUMB_SIZE, WEBGL);
  thumbBuffer.textFont(font);

  txtInputEl = document.getElementById("txtInput");
  sldAmbientEl = document.getElementById("sldAmbient");
  sldDir1IntensityEl = document.getElementById("sldDir1Intensity");
  sldDir1XEl = document.getElementById("sldDir1X");
  sldDir1YEl = document.getElementById("sldDir1Y");
  sldDir1ZEl = document.getElementById("sldDir1Z");
  sldDir2IntensityEl = document.getElementById("sldDir2Intensity");
  sldDir2XEl = document.getElementById("sldDir2X");
  sldDir2YEl = document.getElementById("sldDir2Y");
  sldDir2ZEl = document.getElementById("sldDir2Z");
  sldGlassAlphaEl = document.getElementById("sldGlassAlpha");
  sldGlassShininessEl = document.getElementById("sldGlassShininess");
  sldEmissiveEl = document.getElementById("sldEmissive");
  colorPickerEl = document.getElementById("colorPicker");
  chkVisualizeEl = document.getElementById("chkVisualize");
  chkShowPathEl = document.getElementById("chkShowPath");
  boxStepBtnContainerEl = document.getElementById("boxStepBtnContainer");
  boxStepInfoDivEl = document.getElementById("boxStepInfoDiv");
  cursorStepBtnContainerEl = document.getElementById("cursorStepBtnContainer");
  cursorStepInfoDivEl = document.getElementById("cursorStepInfoDiv");
  txtBoxPresetEl = document.getElementById("txtBoxPreset");
  boxPresetErrorDivEl = document.getElementById("boxPresetErrorDiv");
  txtCursorPresetsEl = document.getElementById("txtCursorPresets");
  cursorPresetErrorDivEl = document.getElementById("cursorPresetErrorDiv");
  timelineContainerDivEl = document.getElementById("timelineContainerDiv");
  cursorTypeSelectEl = document.getElementById("selCursorType");

  // Sync the lighting sliders to the box preset's first step, rather than
  // leaving them at whatever the HTML markup happened to hard-code. This
  // matters because draw()'s idle state (see below) uses these slider
  // values as the "current" lighting rig, so on load they need to agree
  // with boxPreset[0] or the box will render different lighting than the
  // preset specifies until you press Play or click a step.
  syncLightSlidersFrom(boxPreset[0]);

  // Offscreen 2D-style texture for the box-face label. We render the text
  // once here (and again whenever the input changes) into a p5.Graphics
  // buffer, then texture a plane() with it in draw() instead of calling
  // text() directly in the lit WEBGL scene.
  textTexture = createGraphics(w * TEXT_TEX_SCALE, h * TEXT_TEX_SCALE);
  updateTextTexture(txtInputEl.value);
  txtInputEl.addEventListener("input", () => updateTextTexture(txtInputEl.value));

  // Easing setup — loadEasings() returns a name -> function map; the select
  // element lets the user choose which curve shapes every MOVE-phase
  // progress value (box rotation/zoom/light AND cursor path/scale/twist).
  easings = loadEasings();
  easingSelect = document.getElementById("selEasing");

  masterPath = initialMasterPath.map((p) => ({ x: p.x, y: p.y }));
  rawCursorPresets = initialCursorPresets.map((p) => normalizeRawCursorPreset(p));
  presets = buildCursorPresetsFromRaw(rawCursorPresets);
  cursorRuns = computeCursorRuns(presets);

  txtBoxPresetEl.value = stringifyBoxPresetRaw(rawBoxPreset);
  txtCursorPresetsEl.value = JSON.stringify(rawCursorPresets, null, 2);

  document.getElementById("btnAnim").addEventListener("click", toggleBoth);
  document.getElementById("btnApplyBox").addEventListener("click", applyBoxPresets);
  document.getElementById("btnResetBox").addEventListener("click", resetBoxPresets);
  document.getElementById("btnApplyCursor").addEventListener("click", applyCursorPresets);
  document.getElementById("btnResetCursor").addEventListener("click", resetCursorPresets);

  if (cursorTypeSelectEl) {
    cursorTypeSelectEl.addEventListener("change", () => {
      // Switching shape mid-motion can jump the smoothed angle since the two
      // shapes use different angle conventions — reset so it re-snaps clean.
      liveCursorAngleRef.value = null;
      rebuildBoxStepButtons();
      rebuildCursorStepButtons();
    });
  }

  buildTimeline();
  rebuildBoxStepButtons();
  rebuildCursorStepButtons();

  // KEY PRESSES
  document.addEventListener("keydown", (e) => {
    let inField = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";

    if (e.code === "Space" && !inField) {
      e.preventDefault();
      document.getElementById("btnAnim").click();
      return;
    }

    if (!inField && e.key >= "0" && e.key <= "9") {
      let i = Number(e.key);
      let list = selectedComponent === "box" ? boxPreset : presets;
      if (i < list.length) {
        e.preventDefault();
        if (selectedComponent === "box") showBoxStep(i);
        else showCursorStep(i);
      }
    }
  });
}

function makeStepThumbImg(elapsedMs) {
  let thumb = document.createElement("img");
  thumb.className = "step-thumb";

  thumb.width = 80;
  thumb.height = 80;

  thumb.style.flex = "0 0 auto";
  thumb.style.border = "1px solid #555";
  thumb.style.background = "#000";
  thumb.style.objectFit = "cover";
  thumb.style.borderRadius = "2px";
  // thumb.src = renderThumbnailDataURL(elapsedMs);
  return thumb;
}

function applyBoxPresets() {
  let raw;
  try {
    raw = parseBoxPresetText(txtBoxPresetEl.value);
  } catch (e) {
    boxPresetErrorDivEl.textContent = "Invalid JSON: " + e.message;
    return;
  }

  if (!Array.isArray(raw) || raw.length < 2) {
    boxPresetErrorDivEl.textContent = "The box animation array must be a JSON array with at least 2 entries.";
    return;
  }

  boxPresetErrorDivEl.textContent = "";
  rawBoxPreset = raw.map(normalizeBoxPreset);
  boxPreset = buildBoxPresetFromRaw(rawBoxPreset);

  isAnimating = false;
  isBoxFinished = false;
  boxPlayIndex = 0;
  boxAnimStart = 0;
  boxIsHolding = false;
  playbackClockStart = 0;

  buildTimeline();
  rebuildBoxStepButtons();
  rebuildCursorStepButtons();

  // If a step thumbnail was selected before editing, jump back to that same
  // frame using the freshly-applied values instead of resetting to the idle
  // default view — this is what lets you keep tweaking one frame at a time.
  if (lastSelectedStepKind === "box") {
    showBoxStep(constrain(lastSelectedStepIndex, 0, boxPreset.length - 1));
  } else if (lastSelectedStepKind === "cursor") {
    showCursorStep(constrain(lastSelectedStepIndex, 0, presets.length - 1));
  } else {
    isSeeking = false;
    // Keep the lighting sliders in sync with the (possibly edited) preset's
    // first step, so the idle-state render (see draw()) immediately reflects
    // whatever lighting values were just applied.
    syncLightSlidersFrom(boxPreset[0]);
  }
}

function resetBoxPresets() {
  rawBoxPreset = JSON.parse(JSON.stringify(defaultBoxPresetRaw));
  txtBoxPresetEl.value = stringifyBoxPresetRaw(rawBoxPreset);
  boxPresetErrorDivEl.textContent = "";
  applyBoxPresets();
}

function applyCursorPresets() {
  let raw;
  try {
    raw = JSON.parse(txtCursorPresetsEl.value);
  } catch (e) {
    cursorPresetErrorDivEl.textContent = "Invalid JSON: " + e.message;
    return;
  }

  if (!Array.isArray(raw) || raw.length < 2) {
    cursorPresetErrorDivEl.textContent = "The animation array must be a JSON array with at least 2 entries.";
    return;
  }

  for (let i = 0; i < raw.length; i++) {
    let p = raw[i];
    if (!p || typeof p.pathIndex !== "number") {
      cursorPresetErrorDivEl.textContent = `Entry ${i} needs a numeric pathIndex.`;
      return;
    }
    if (typeof p.scale !== "number") p.scale = 1;
    if (typeof p.angleTwist !== "number") p.angleTwist = 0;
    if (typeof p.rotX !== "number") p.rotX = 0;
    if (typeof p.rotY !== "number") p.rotY = 0;
    if (typeof p.rotZ !== "number") p.rotZ = 0;
    if (typeof p.ms !== "number") p.ms = 0;
    if (typeof p.hold !== "number") p.hold = 0;
    if (typeof p.cameraZoom !== "boolean") p.cameraZoom = false;
    p.pathIndex = constrain(p.pathIndex, 0, masterPath.length - 1);
  }

  cursorPresetErrorDivEl.textContent = "";
  rawCursorPresets = raw;
  presets = buildCursorPresetsFromRaw(rawCursorPresets);
  cursorRuns = computeCursorRuns(presets);

  isCursorPlaying = false;
  isCursorFinished = false;
  cursorPlayIndex = 0;
  cursorStartTime = 0;
  liveCursorAngleRef.value = null;
  cursorPlaybackClockStart = 0;

  buildTimeline();
  rebuildBoxStepButtons();
  rebuildCursorStepButtons();

  // Same "stay on the selected frame" behavior as applyBoxPresets() above.
  if (lastSelectedStepKind === "cursor") {
    showCursorStep(constrain(lastSelectedStepIndex, 0, presets.length - 1));
  } else if (lastSelectedStepKind === "box") {
    showBoxStep(constrain(lastSelectedStepIndex, 0, boxPreset.length - 1));
  } else {
    isSeeking = false;
  }
}

function resetCursorPresets() {
  rawCursorPresets = initialCursorPresets.map((p) => normalizeRawCursorPreset(p));
  txtCursorPresetsEl.value = JSON.stringify(rawCursorPresets, null, 2);
  cursorPresetErrorDivEl.textContent = "";
  applyCursorPresets();
}

// Returns the elapsed ms at which the animation actually *arrives* at step i,
// i.e. after that step's full move+hold (hold is now folded in as decel time,
// not a separate frozen phase — see computeBoxValueAtElapsed / computeCursorValueAtElapsed).
function stepArrivalTime(segs, i) {
  if (!segs || segs.length === 0) return 0;
  let idx = constrain(i, 0, segs.length - 1);
  return segs[idx].segStart + segs[idx].segTotal;
}

// Generic "move then freeze" sampler, shared by the box and the cursor.
// `segs` comes from computeSegments(presetArr, false), which already lays
// out each step as [move for its own `ms`][freeze for its own `hold`] — the
// exact same structure the timeline UI displays. `pairLerpFn(p1, p2, t)`
// does the property-specific interpolation for whichever preset array this is.
function valueAtElapsedFromSegs(segs, presetArr, elapsedMs, pairLerpFn) {
  if (!segs || segs.length === 0) return null;
  for (let s of segs) {
    let moveEnd = s.segStart + s.firstDur; // firstDur === move (ms) for holdFirst=false segs
    let segEnd = s.segStart + s.segTotal;
    if (elapsedMs < moveEnd) {
      let p1 = presetArr[Math.max(0, s.index - 1)];
      let p2 = presetArr[s.index];
      let progress = s.firstDur > 0 ? constrain((elapsedMs - s.segStart) / s.firstDur, 0, 1) : 1;
      progress = applyEasing(progress);
      return pairLerpFn(p1, p2, progress);
    }
    if (elapsedMs < segEnd) {
      // Past the move, inside this step's hold window — frozen at this step's values.
      return pairLerpFn(presetArr[s.index], presetArr[s.index], 1);
    }
  }
  let last = presetArr[presetArr.length - 1];
  return pairLerpFn(last, last, 1);
}

function lerpBoxPair(p1, p2, progress) {
  return {
    rotX: lerp(p1.rotX, p2.rotX, progress),
    rotY: lerp(p1.rotY, p2.rotY, progress),
    rotZ: lerp(p1.rotZ, p2.rotZ, progress),
    zoom: lerp(p1.zoom, p2.zoom, progress),
    ambientIntensity: lerp(p1.ambientIntensity, p2.ambientIntensity, progress),
    dir1Intensity: lerp(p1.dir1Intensity, p2.dir1Intensity, progress),
    dir1X: lerp(p1.dir1X, p2.dir1X, progress),
    dir1Y: lerp(p1.dir1Y, p2.dir1Y, progress),
    dir1Z: lerp(p1.dir1Z, p2.dir1Z, progress),
    dir2Intensity: lerp(p1.dir2Intensity, p2.dir2Intensity, progress),
    dir2X: lerp(p1.dir2X, p2.dir2X, progress),
    dir2Y: lerp(p1.dir2Y, p2.dir2Y, progress),
    dir2Z: lerp(p1.dir2Z, p2.dir2Z, progress),
    glassAlpha: lerp(p1.glassAlpha, p2.glassAlpha, progress),
    glassShininess: lerp(p1.glassShininess, p2.glassShininess, progress),
    emissiveIntensity: lerp(p1.emissiveIntensity, p2.emissiveIntensity, progress),
  };
}

// Computes the box's interpolated state at any elapsed ms on the shared
// timeline. `ms` is a pure move duration and `hold` is a pure freeze
// afterward — they no longer blend into one long eased span.
function computeBoxValueAtElapsed(elapsedMs) {
  if (!boxPreset || boxPreset.length === 0) return {};
  if (boxPreset.length === 1) return { ...boxPreset[0] };
  let segs = computeSegments(boxPreset, false).segs;
  return valueAtElapsedFromSegs(segs, boxPreset, elapsedMs, lerpBoxPair);
}

function boxTotalDurationMs() {
  return boxPreset && boxPreset.length > 0 ? computeSegments(boxPreset, false).total : 0;
}

// Computes the cursor's interpolated state at any elapsed ms on the shared timeline.
function cursorValueFromSample(sample) {
  let { p1, p2, t } = sample;
  let rawIdx = map(t, 0, 1, p1.pathIndex, p2.pathIndex);
  let low = floor(rawIdx);
  let high = ceil(rawIdx);
  let frac = rawIdx - low;

  let pA = masterPath[constrain(low, 0, masterPath.length - 1)];
  let pB = masterPath[constrain(high, 0, masterPath.length - 1)];
  let posX = lerp(pA.x, pB.x, frac);
  let posY = lerp(pA.y, pB.y, frac);

  // Always derive direction from the local path tangent around the current
  // position (low..high). When p1.pathIndex === p2.pathIndex, low === high,
  // so this naturally becomes the tangent at that single point — i.e. the
  // direction the path was heading when the cursor arrived there — rather
  // than a hard "no motion = no direction" zero that discarded that info.
  let behind = masterPath[constrain(low - DIR_LOOKAHEAD, 0, masterPath.length - 1)];
  let ahead = masterPath[constrain(high + DIR_LOOKAHEAD, 0, masterPath.length - 1)];
  let dx = ahead.x - behind.x;
  let dy = ahead.y - behind.y;
  if (dx === 0 && dy === 0) {
    dx = p2.x - p1.x;
    dy = p2.y - p1.y;
  }

  return {
    x: posX, y: posY, dx, dy,
    scale: lerp(p1.scale, p2.scale, t),
    angleTwist: lerp(p1.angleTwist, p2.angleTwist, t),
    rotX: lerp(p1.rotX, p2.rotX, t),
    rotY: lerp(p1.rotY, p2.rotY, t),
    rotZ: lerp(p1.rotZ, p2.rotZ, t),
    // NOTE: uses the *departure* step's cameraZoom flag for the whole leg
    // (matches live playback and the old HOLD-branch behavior) so scrubbing
    // and thumbnails don't flip coordinate frames mid-transition.
    cameraZoom: p1.cameraZoom,
  };
}

// `ms` is a pure move duration, `hold` is a pure freeze afterward — same
// model as the box. When frozen (p1 === p2), cursorValueFromSample naturally
// falls back to the local path tangent for direction, since p2.pathIndex -
// p1.pathIndex is zero.
//
// Unlike the box, MOVE phases are sampled via the run system
// (computeCursorRuns / sampleRun): consecutive steps connected by hold === 0
// are treated as one continuous eased motion instead of each leg getting
// its own full ease-in/ease-out, which used to make the cursor decelerate
// to near-zero speed at every interior waypoint — visually indistinguishable
// from an actual hold even though hold was 0 the whole time.
function computeCursorValueAtElapsed(elapsedMs) {
  if (!presets || presets.length === 0) return null;
  if (presets.length === 1) {
    let p = presets[0];
    let tan = pathTangentAt(p.pathIndex);
    return { x: p.x, y: p.y, dx: tan.dx, dy: tan.dy, scale: p.scale, angleTwist: p.angleTwist,
             rotX: p.rotX, rotY: p.rotY, rotZ: p.rotZ, cameraZoom: p.cameraZoom };
  }

  let segs = computeSegments(presets, false).segs;
  let status = sceneStatusAtElapsed(segs, elapsedMs);
  if (!status) return cursorValueFromSample({ p1: presets[0], p2: presets[0], t: 1 });

  if (status.phase === "END") {
    let last = presets[presets.length - 1];
    return cursorValueFromSample({ p1: last, p2: last, t: 1 });
  }

  if (status.phase === "HOLD") {
    let p = presets[status.index];
    return cursorValueFromSample({ p1: p, p2: p, t: 1 });
  }

  // MOVE phase: locate the run this leg belongs to and ease across the
  // whole run rather than just this one leg.
  let run = findRunForIndex(cursorRuns, status.index - 1);
  let p1, p2, t;

  if (run) {
    let legOffset = runElapsedOffset(run, presets, status.index - 1);
    let elapsedInRun = status.phaseElapsed + legOffset;
    let sample = sampleRun(run, presets, elapsedInRun);
    p1 = sample.p1;
    p2 = sample.p2;
    t = sample.t;
  } else {
    p1 = presets[Math.max(0, status.index - 1)];
    p2 = presets[status.index];
    let progress = status.phaseDur > 0 ? constrain(status.phaseElapsed / status.phaseDur, 0, 1) : 1;
    t = applyEasing(progress);
  }

  return cursorValueFromSample({ p1, p2, t });
}

function cursorTotalDurationMs() {
  return presets && presets.length > 0 ? computeSegments(presets, false).total : 0;
}

// Clicking a box step seeks the *entire shared timeline* to that step's
// arrival time — both the box and cursor jump to whatever they'd look like
// at that exact millisecond, and the shared playhead moves there too.
function showBoxStep(i) {
  isAnimating = false;
  isBoxFinished = false;
  boxIsHolding = false;
  boxPlayIndex = 0;
  boxAnimStart = 0;
  playbackClockStart = 0;

  isCursorPlaying = false;
  isCursorFinished = false;
  cursorIsHolding = false;
  cursorPlayIndex = 0;
  cursorStartTime = 0;
  liveCursorAngleRef.value = null;
  cursorPlaybackClockStart = 0;

  isSeeking = true;
  boxPreviewStepIndex = i;
  seekElapsedMs = stepArrivalTime(boxTimelineBar.segs, i);

  lastSelectedStepKind = "box";
  lastSelectedStepIndex = i;

  let bv = computeBoxValueAtElapsed(seekElapsedMs);
  syncLightSlidersFrom(bv);

  updateBoxStepInfo(i);

  let cStatus = sceneStatusAtElapsed(cursorTimelineBar.segs, seekElapsedMs);
  if (cStatus) {
    cursorPreviewStepIndex = cStatus.index;
    updateCursorStepInfo(cStatus.index);
  }

  rebuildBoxStepButtons();
  rebuildCursorStepButtons();
}

function updateBoxStepInfo(i) {
  let bp = boxPreset[i];
  let lines = [];
  lines.push(`BOX STEP ${i}`);
  lines.push(`rotX ${bp.rotX.toFixed(2)}  rotY ${bp.rotY.toFixed(2)}  rotZ ${bp.rotZ.toFixed(2)}  zoom ${bp.zoom}`);
  lines.push(`ambient ${bp.ambientIntensity}`);
  lines.push(`dir1 int ${bp.dir1Intensity}  dir (${bp.dir1X.toFixed(2)}, ${bp.dir1Y.toFixed(2)}, ${bp.dir1Z.toFixed(2)})`);
  lines.push(`dir2 int ${bp.dir2Intensity}  dir (${bp.dir2X.toFixed(2)}, ${bp.dir2Y.toFixed(2)}, ${bp.dir2Z.toFixed(2)})`);
  lines.push(`glass alpha ${bp.glassAlpha}  shininess ${bp.glassShininess}  emissive ${bp.emissiveIntensity}`);
  lines.push(`ms ${bp.ms}  hold ${bp.hold}`);
  boxStepInfoDivEl.innerHTML = lines.join("<br>");
}

// Clicking a cursor step seeks the *entire shared timeline* to that step's
// arrival time — both the box and cursor jump to whatever they'd look like
// at that exact millisecond, and the shared playhead moves there too.
function showCursorStep(i) {
  isCursorPlaying = false;
  isCursorFinished = false;
  cursorIsHolding = false;
  cursorPlayIndex = 0;
  cursorStartTime = 0;
  liveCursorAngleRef.value = null;
  cursorPlaybackClockStart = 0;

  isAnimating = false;
  isBoxFinished = false;
  boxIsHolding = false;
  boxPlayIndex = 0;
  boxAnimStart = 0;
  playbackClockStart = 0;

  isSeeking = true;
  cursorPreviewStepIndex = i;
  seekElapsedMs = stepArrivalTime(cursorTimelineBar.segs, i);

  lastSelectedStepKind = "cursor";
  lastSelectedStepIndex = i;

  updateCursorStepInfo(i);

  let bStatus = sceneStatusAtElapsed(boxTimelineBar.segs, seekElapsedMs);
  if (bStatus) {
    boxPreviewStepIndex = bStatus.index;
    updateBoxStepInfo(bStatus.index);

    let bv = computeBoxValueAtElapsed(seekElapsedMs);
    syncLightSlidersFrom(bv);
  }

  rebuildBoxStepButtons();
  rebuildCursorStepButtons();
}

function updateCursorStepInfo(i) {
  let cp = presets[i];
  let lines = [];
  lines.push(`CURSOR STEP ${i}`);
  lines.push(`x ${cp.x.toFixed(1)}  y ${cp.y.toFixed(1)}  pathIndex ${cp.pathIndex}`);
  lines.push(`scale ${cp.scale}  angleTwist ${cp.angleTwist}`);
  lines.push(`rotX ${cp.rotX}  rotY ${cp.rotY}  rotZ ${cp.rotZ}`);
  lines.push(`ms ${cp.ms}  hold ${cp.hold}  cameraZoom ${cp.cameraZoom}`);
  cursorStepInfoDivEl.innerHTML = lines.join("<br>");
}

function computeSegments(presetArr, holdFirst) {
  let n = presetArr.length;
  let t = 0;
  let segs = [];
  for (let i = 0; i < n; i++) {
    let hold = presetArr[i].hold;
    let move = presetArr[i].ms;

    if (holdFirst) {
      if (i === n - 1) {
        hold = 0;
        move = 0;
      }
    } else {
      if (i === 0) move = 0;
      if (i === n - 1) hold = 0;
    }

    let firstDur = holdFirst ? hold : move;
    let secondDur = holdFirst ? move : hold;

    segs.push({
      index: i,
      segStart: t,
      holdFirst,
      firstDur,
      secondDur,
      hold,
      move,
      segTotal: firstDur + secondDur,
    });
    t += firstDur + secondDur;
  }
  return { segs, total: t };
}

function stepPctFor(segs, axisTotal, i) {
  if (axisTotal <= 0 || segs.length === 0) return 0;
  let idx = constrain(i, 0, segs.length - 1);
  return (segs[idx].segStart / axisTotal) * 100;
}

function sceneStatusAtElapsed(segs, elapsedMs) {
  if (segs.length === 0) return null;
  for (let s of segs) {
    let segEnd = s.segStart + s.segTotal;
    if (elapsedMs < segEnd) {
      let intoSeg = elapsedMs - s.segStart;
      if (intoSeg < s.firstDur) {
        return { index: s.index, phase: s.holdFirst ? "HOLD" : "MOVE", phaseElapsed: intoSeg, phaseDur: s.firstDur };
      }
      return { index: s.index, phase: s.holdFirst ? "MOVE" : "HOLD", phaseElapsed: intoSeg - s.firstDur, phaseDur: s.secondDur };
    }
  }
  let last = segs[segs.length - 1];
  return { index: last.index, phase: "END", phaseElapsed: 0, phaseDur: 0 };
}

function formatSceneStatus(label, status) {
  if (!status) return `${label}: —`;
  if (status.phase === "END") return `${label}: step ${status.index} · finished`;
  return `${label}: step ${status.index} · ${status.phase} · ${Math.round(status.phaseElapsed)}ms / ${status.phaseDur}ms`;
}

function createAxisRuler(axisTotal, parent) {
  let row = document.createElement("div");
  row.style.position = "relative";

  row.style.margin = "4px 48px";
  row.style.width = TIMELINE_TRACK_PX + "px";
  row.style.height = "12px";
  row.style.borderBottom = "1px solid rgba(0,0,0,0.16)";
  parent.appendChild(row);

  for (let t = 0; t <= axisTotal; t += 100) {
    let pct = (t / axisTotal) * 100;
    let tick = document.createElement("div");
    tick.style.position = "absolute";
    tick.style.left = pct + "%";
    tick.style.bottom = "0";
    tick.style.width = "1px";
    tick.style.height = "4px";
    tick.style.background = "rgba(0,0,0,0.16)";
    row.appendChild(tick);

    let lbl = document.createElement("span");
    lbl.textContent = `${t}`;
    lbl.style.position = "absolute";
    lbl.style.left = pct + "%";
    lbl.style.bottom = "4px";
    lbl.style.transform = "translateX(-50%)";
    lbl.style.fontSize = "9px";
    lbl.style.color = "rgba(0,0,0,0.4)";
    lbl.style.whiteSpace = "nowrap";
    row.appendChild(lbl);
  }
}

function addAxisGridlines(track, axisTotal) {
  for (let t = 100; t < axisTotal; t += 100) {
    let pct = (t / axisTotal) * 100;
    let gl = document.createElement("div");
    gl.style.position = "absolute";
    gl.style.left = pct + "%";
    gl.style.top = "0";
    gl.style.width = "1px";
    gl.style.height = "100%";
    gl.style.background = "rgba(255,255,255,0.08)";
    gl.style.pointerEvents = "none";
    track.appendChild(gl);
  }
}

function buildTimeline() {
  timelineContainerDivEl.innerHTML = "";

  let box = computeSegments(boxPreset, false);
  let cursor = computeSegments(presets, false);

  let axisTotal = Math.max(100, Math.ceil(Math.max(box.total, cursor.total, 1) / 100) * 100);

  createAxisRuler(axisTotal, timelineContainerDivEl);

  // shared wrapper holding both tracks so one playhead can span across them, gap included
  let tracksWrapper = document.createElement("div");
  tracksWrapper.style.position = "relative";
  timelineContainerDivEl.appendChild(tracksWrapper);

  let boxResult = createTimelineBar(box.segs, box.total, axisTotal, tracksWrapper, "Box");
  boxTimelineBar = boxResult.bar;
  boxSceneLabel = boxResult.sceneLabel;

  let cursorResult = createTimelineBar(cursor.segs, cursor.total, axisTotal, tracksWrapper, "Cursor");
  cursorTimelineBar = cursorResult.bar;
  cursorSceneLabel = cursorResult.sceneLabel;

  sharedPlayhead = document.createElement("div");
  sharedPlayhead.style.position = "absolute";
  sharedPlayhead.style.top = "0";
  sharedPlayhead.style.left = "48px";
  sharedPlayhead.style.width = "2px";
  sharedPlayhead.style.height = "100%";

  sharedPlayhead.style.background = "#ff6f00d8";

  sharedPlayhead.style.display = "none";
  sharedPlayhead.style.zIndex = "99";
  sharedPlayhead.style.pointerEvents = "none";
  tracksWrapper.appendChild(sharedPlayhead);

  updateTimelinePlayheads();
}

function buildTimelineTable(segs, parent, label) {
  let heading = document.createElement("p");
  heading.textContent = `${label} — per-step breakdown`;
  heading.style.margin = "10px 0 4px 0";
  heading.style.fontWeight = "bold";
  parent.appendChild(heading);

  let table = document.createElement("table");
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "11px";
  table.style.marginBottom = "6px";
  parent.appendChild(table);

  let headerRow = document.createElement("tr");
  table.appendChild(headerRow);
  ["Step", "Hold", "Move", "Step total", "Cumulative"].forEach((h) => {
    let th = document.createElement("th");
    th.textContent = h;
    th.style.border = "1px solid #555";
    th.style.padding = "2px 8px";
    th.style.textAlign = "left";
    headerRow.appendChild(th);
  });

  let cumulative = 0;
  for (let s of segs) {
    cumulative += s.segTotal;
    let row = document.createElement("tr");
    table.appendChild(row);
    let cells = [
      `${s.index}`,
      `${s.hold}ms (${(s.hold / 1000).toFixed(2)}s)`,
      `${s.move}ms (${(s.move / 1000).toFixed(2)}s)`,
      `${s.segTotal}ms (${(s.segTotal / 1000).toFixed(2)}s)`,
      `${cumulative}ms (${(cumulative / 1000).toFixed(2)}s)`,
    ];
    cells.forEach((c) => {
      let td = document.createElement("td");
      td.textContent = c;
      td.style.border = "1px solid #555";
      td.style.padding = "2px 8px";
      row.appendChild(td);
    });
  }
}

function secondIsHold(firstIsHold) {
  return !firstIsHold;
}
function secondIsHoldColor(isHold) {
  return isHold ? "#000" : "#fff";
}

function createTimelineBar(segs, ownTotal, axisTotal, parent, label) {
  const trackPx = TIMELINE_TRACK_PX;

  let outer = document.createElement("div");
  outer.style.marginBottom = "4px"; // gap between Box and Cursor bars
  parent.appendChild(outer);

  let sceneLabel = document.createElement("div"); // detached, kept only so updateTimelinePlayheads() has a target

  let row = document.createElement("div");
  outer.appendChild(row);

  let labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  labelSpan.style.display = "inline-block";
  labelSpan.style.width = "48px";
  
  labelSpan.style.verticalAlign = "center";
  labelSpan.style.fontSize = "12px";

  row.appendChild(labelSpan);

  let track = document.createElement("div");
  track.style.position = "relative";
  track.style.display = "inline-flex";
  track.style.alignItems = "stretch";
  track.style.width = trackPx + "px";
  track.style.height = "48px";

  track.style.background = "#eee";

  track.style.verticalAlign = "top";
  row.appendChild(track);

  addAxisGridlines(track, axisTotal);

  const sceneRowH = 16;

  for (let s of segs) {
    if (s.segTotal <= 0) continue; // zero-duration step — nothing to draw

    let sceneWidthPct = (s.segTotal / axisTotal) * 100;

    let sceneEl = document.createElement("div");
    sceneEl.style.flex = `0 0 ${sceneWidthPct}%`;
    sceneEl.style.boxSizing = "border-box";
    sceneEl.style.height = "100%";
    sceneEl.style.position = "relative";
    sceneEl.style.display = "flex";
    sceneEl.style.flexDirection = "column";
    sceneEl.style.border = "1px solid rgba(0,0,0,0.16)";
    sceneEl.style.marginLeft = s.index > 0 ? "-1px" : "0";
    sceneEl.style.zIndex = "2";
    sceneEl.style.padding = "2px 3px";
    
    track.appendChild(sceneEl);

    let labelRow = document.createElement("div");
    labelRow.textContent = s.index;
    labelRow.style.flex = "0 0 auto";
    labelRow.style.height = sceneRowH + "px";
    labelRow.style.color = "#1b1b1b";
    labelRow.style.display = "flex";
    labelRow.style.alignItems = "center";
    labelRow.style.overflow = "hidden";
    labelRow.style.fontSize = "9px";
    labelRow.style.whiteSpace = "nowrap";
    labelRow.style.boxSizing = "border-box";
    sceneEl.appendChild(labelRow);

    let subRow = document.createElement("div");
    subRow.style.flex = "1 1 auto";
    subRow.style.display = "flex";
    subRow.style.flexDirection = "row";
    sceneEl.appendChild(subRow);

    let firstIsHold = s.holdFirst;
    
    let firstColor = firstIsHold ? "#e8e8e8" : "#1b1b1b";
    let secondColor = firstIsHold ? "#1b1b1b" : "#e8e8e8";

    let firstLabel = firstIsHold ? "hold" : "move";
    let secondLabel = firstIsHold ? "move" : "hold";

    if (s.firstDur > 0) {
      let widthPct = (s.firstDur / s.segTotal) * 100;
      let el = document.createElement("div");
      el.style.flex = `0 0 ${widthPct}%`;

      el.style.boxSizing = "border-box";
      el.style.position = "relative";
      el.style.background = firstColor;
      
      subRow.appendChild(el);

      let px = (s.firstDur / axisTotal) * trackPx;
      if (px > 24) {
        let lbl = document.createElement("span");
        lbl.textContent = s.firstDur
        lbl.style.position = "absolute";

        lbl.style.top = "50%";
        lbl.style.transform = "translate(0%, -50%)";

        lbl.style.marginLeft = "2px";
        lbl.style.fontSize = "9px";
        
        lbl.style.color = firstIsHold ? "#000" : "#fff";
        lbl.style.whiteSpace = "nowrap";
        lbl.style.pointerEvents = "none";
        el.appendChild(lbl);
      }
    }

    if (s.secondDur > 0) {
      let widthPct = (s.secondDur / s.segTotal) * 100;
      let el = document.createElement("div");
      el.style.flex = `0 0 ${widthPct}%`;
      el.style.boxSizing = "border-box";
      el.style.position = "relative";
      el.style.background = secondColor;

      if (secondIsHold(firstIsHold)) {
        el.style.backgroundImage =
          "repeating-linear-gradient(-45deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 2px, transparent 6px)";
      }

      subRow.appendChild(el);

      let px = (s.secondDur / axisTotal) * trackPx;
      if (px > 24) {
        let lbl = document.createElement("span");
        lbl.textContent = s.secondDur;
        lbl.style.position = "absolute";
        lbl.style.top = "50%";
        lbl.style.transform = "translate(0%, -50%)";

        lbl.style.marginLeft = "2px";
        lbl.style.fontSize = "9px";
        lbl.style.color = secondIsHoldColor(secondIsHold(firstIsHold));
        lbl.style.whiteSpace = "nowrap";
        lbl.style.pointerEvents = "none";
        el.appendChild(lbl);
      }
    }
  }

  return { bar: { segs, total: ownTotal, axisTotal }, sceneLabel };
}

function updateTimelinePlayheads() {
  if (!boxTimelineBar || !cursorTimelineBar || !sharedPlayhead) return;

  let pct = null;

  if (isSeeking) {
    pct = (seekElapsedMs / boxTimelineBar.axisTotal) * 100;
    boxSceneLabel.textContent = formatSceneStatus("BOX", sceneStatusAtElapsed(boxTimelineBar.segs, seekElapsedMs));
    cursorSceneLabel.textContent = formatSceneStatus("CURSOR", sceneStatusAtElapsed(cursorTimelineBar.segs, seekElapsedMs));
  } else {
    if (isAnimating) {
      let elapsed = constrain(millis() - playbackClockStart, 0, boxTimelineBar.total);
      pct = (elapsed / boxTimelineBar.axisTotal) * 100;
      boxSceneLabel.textContent = formatSceneStatus("BOX", sceneStatusAtElapsed(boxTimelineBar.segs, elapsed));
    } else {
      boxSceneLabel.textContent = "BOX: —";
    }

    if (isCursorPlaying) {
      let elapsed = constrain(millis() - cursorPlaybackClockStart, 0, cursorTimelineBar.total);
      if (pct === null) pct = (elapsed / cursorTimelineBar.axisTotal) * 100;
      cursorSceneLabel.textContent = formatSceneStatus("CURSOR", sceneStatusAtElapsed(cursorTimelineBar.segs, elapsed));
    } else {
      cursorSceneLabel.textContent = "CURSOR: —";
    }
  }

  sharedPlayhead.style.display = "block";
  sharedPlayhead.style.left = `calc(48px + ${(pct / 100) * TIMELINE_TRACK_PX}px)`;
}

function toggleBoth() {
  toggleBox();
  toggleCursor();
}

function toggleBox() {
  isSeeking = false;
  lastSelectedStepKind = null;
  if (!isAnimating && boxPreset.length >= 2) {
    isAnimating = true;
    isBoxFinished = false;
    boxPlayIndex = 0;
    boxAnimStart = 0;
    boxIsHolding = false;
    playbackClockStart = millis();
  } else {
    isAnimating = false;
    isBoxFinished = false;
    boxIsHolding = false;
    boxPlayIndex = 0;
    boxAnimStart = 0;
    playbackClockStart = 0;
    let first = boxPreset[0];
    syncLightSlidersFrom(first);
  }
}

function toggleCursor() {
  isSeeking = false;
  lastSelectedStepKind = null;
  if (!isCursorPlaying && presets.length >= 2) {
    isCursorPlaying = true;
    isCursorFinished = false;
    cursorPlayIndex = 0;
    cursorStartTime = 0;
    cursorIsHolding = false;
    liveCursorAngleRef.value = null;
    cursorPlaybackClockStart = millis();
  } else {
    isCursorPlaying = false;
    isCursorFinished = false;
    cursorIsHolding = false;
    cursorPlayIndex = 0;
    cursorStartTime = 0;
    liveCursorAngleRef.value = null;
    cursorPlaybackClockStart = 0;
  }
}

function draw() {
  background(0);
  updateTimelinePlayheads();

  let targetRotX = 0, targetRotY = 0, targetRotZ = 0, targetZoom = boxPreset[0].zoom;
  let L = readLightSliders();

  if (isSeeking) {
    let bv = computeBoxValueAtElapsed(seekElapsedMs);
    targetRotX = bv.rotX;
    targetRotY = bv.rotY;
    targetRotZ = bv.rotZ;
    targetZoom = bv.zoom;
    L = bv;
    syncLightSlidersFrom(L);
  } else if (isAnimating) {
    let elapsed = millis() - playbackClockStart;
    let totalDur = boxTotalDurationMs();
    if (elapsed >= totalDur) {
      elapsed = totalDur;
      isAnimating = false;
      isBoxFinished = true;
    }
    let v = computeBoxValueAtElapsed(elapsed);
    targetRotX = v.rotX;
    targetRotY = v.rotY;
    targetRotZ = v.rotZ;
    targetZoom = v.zoom;
    L = v;
    syncLightSlidersFrom(L);
  } else if (isBoxFinished) {
    let last = boxPreset[boxPreset.length - 1];
    targetRotX = last.rotX;
    targetRotY = last.rotY;
    targetRotZ = last.rotZ;
    targetZoom = last.zoom;
    L = last;
    syncLightSlidersFrom(L);
  } else {
    // IDLE state (never played / stopped at the start). Mirrors
    // rotX/rotY/rotZ/zoom above and pulls straight from the preset's first
    // entry, keeping the sliders in sync with it, so edits made via the
    // textarea + Apply show up immediately instead of only after Play.
    let first = boxPreset[0];
    targetRotX = first.rotX;
    targetRotY = first.rotY;
    targetRotZ = first.rotZ;
    targetZoom = first.zoom;
    L = first;
    syncLightSlidersFrom(L);
  }

  camera(0, 0, targetZoom, 0, 0, 0, 0, 1, 0);
  rotateX(targetRotX);
  rotateY(targetRotY);
  rotateZ(targetRotZ);

  ambientLight(L.ambientIntensity, L.ambientIntensity, L.ambientIntensity);
  directionalLight(L.dir1Intensity, L.dir1Intensity, L.dir1Intensity, L.dir1X, L.dir1Y, L.dir1Z);
  directionalLight(L.dir2Intensity, L.dir2Intensity, L.dir2Intensity, L.dir2X, L.dir2Y, L.dir2Z);

  let col = color(colorPickerEl.value);
  specularMaterial(red(col), green(col), blue(col));
  shininess(L.glassShininess);

  // Drives the glassShader's edge-emissive rim-light strength this frame —
  // see getEmissiveIntensity()/currentEmissiveIntensity near the top of the
  // file for why a plain outer variable works as a live shader uniform here.
  currentEmissiveIntensity = L.emissiveIntensity;

  // Box: extruded rounded-rect model + glass Material Hook shader (built
  // once in setup(), see boxModel / glassShader above), instead of the old
  // drawExtrudedRoundedRect()/drawBorder() immediate-mode geometry.
  noStroke();
  fill(red(col), green(col), blue(col), L.glassAlpha);
  push();
  // extrudeContours() runs the model from z=0 to roughly z=(d+BOX_BEVEL), not
  // symmetric about the origin like the old box was — recenter it here so it
  // rotates the same way, and so the text plane's translate(0,0,d/2+1) below
  // still lines up with its camera-facing cap.
  translate(0, 0, -(d / 2 + BOX_BEVEL));
  shader(glassShader);
  model(boxModel);
  resetShader();
  pop();

  // Label texture: render the input text into an offscreen graphics buffer
  // once (updateTextTexture, cached in textTexture / lastRenderedText, and
  // refreshed on input), then texture a plane() with it in front of the box
  // face — the same "text-to-texture" trick as texturing a button label,
  // instead of calling text() directly inside the lit WEBGL scene.
  if (txtInputEl.value !== lastRenderedText) updateTextTexture(txtInputEl.value);
  push();
  noStroke();
  noLights();
  texture(textTexture);
  translate(0, 0, d / 2 + 1);
  plane(w, h);
  pop();
  // restore lighting for anything drawn after the label (e.g. the light-direction lines below)
  ambientLight(L.ambientIntensity, L.ambientIntensity, L.ambientIntensity);
  directionalLight(L.dir1Intensity, L.dir1Intensity, L.dir1Intensity, L.dir1X, L.dir1Y, L.dir1Z);
  directionalLight(L.dir2Intensity, L.dir2Intensity, L.dir2Intensity, L.dir2X, L.dir2Y, L.dir2Z);

  if (chkVisualizeEl.checked) {
    push();
    resetShader();
    strokeWeight(2);

    // Light 1 path (yellow)
    stroke(255, 255, 0);
    let l1Dir = createVector(L.dir1X, L.dir1Y, L.dir1Z).normalize().mult(-150);
    line(0, 0, 0, l1Dir.x, l1Dir.y, l1Dir.z);

    // Light 2 path (cyan)
    stroke(0, 255, 255);
    let l2Dir = createVector(L.dir2X, L.dir2Y, L.dir2Z).normalize().mult(-150);
    line(0, 0, 0, l2Dir.x, l2Dir.y, l2Dir.z);
    pop();
  }

  // Figure out this frame's cursor value once, then reuse it both for the
  // cameraZoom flag and for the actual draw call below.
  let cv = null;
  if (isSeeking) {
    cv = computeCursorValueAtElapsed(seekElapsedMs);
  } else if (isCursorPlaying) {
    let cElapsed = millis() - cursorPlaybackClockStart;
    let cTotalDur = cursorTotalDurationMs();
    if (cElapsed >= cTotalDur) {
      cElapsed = cTotalDur;
      isCursorPlaying = false;
      isCursorFinished = true;
    }
    cv = computeCursorValueAtElapsed(cElapsed);
  } else if (isCursorFinished && presets.length > 0) {
    let last = presets[presets.length - 1];
    cv = { x: last.x, y: last.y, dx: 0, dy: 0, scale: last.scale, angleTwist: last.angleTwist,
           rotX: last.rotX, rotY: last.rotY, rotZ: last.rotZ, cameraZoom: last.cameraZoom };
  } else if (presets.length > 0) {
    let first = presets[0];
    cv = { x: first.x, y: first.y, dx: 0, dy: 0, scale: first.scale, angleTwist: first.angleTwist,
           rotX: first.rotX, rotY: first.rotY, rotZ: first.rotZ, cameraZoom: first.cameraZoom };
  }

  let cursorCameraZoom = cv ? !!cv.cameraZoom : false;
  if (!cursorCameraZoom) {
    resetMatrix();
    camera();
  }

  noLights();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  push();
  translate(-width / 2, -height / 2, 0);

  if (chkShowPathEl.checked && masterPath.length > 0) {
    noFill();
    stroke(255);
    strokeWeight(2);
    beginShape();
    for (let p of masterPath) vertex(p.x, p.y, 0);
    endShape();
  }

  if (cv) {
    let cursorType = cursorTypeSelectEl ? cursorTypeSelectEl.value : "arrow";
    drawCursorIcon(window, liveCursorAngleRef, cv.x, cv.y, cv.dx, cv.dy, cv.scale, cv.angleTwist, cv.rotX, cv.rotY, cv.rotZ, cursorType);
  }

  pop();
  drawingContext.enable(drawingContext.DEPTH_TEST);
}

// NOTE: no longer called by draw() — the box is now drawn via boxModel +
// glassShader (see setup() and draw() above). Left here in case you want to
// revert to the old flat immediate-mode box.
function drawExtrudedRoundedRect(g, w, h, depth, r) {
  let halfW = w / 2, halfH = h / 2, halfD = depth / 2, steps = 40;
  for (let z of [-halfD, halfD]) {
    g.push();
    g.translate(0, 0, z);
    if (z > 0) g.rotateY(PI);
    g.beginShape();
    for (let i = 0; i <= steps; i++) {
      let a = map(i, 0, steps, 0, TWO_PI);
      let x = a < HALF_PI || a > 3 * HALF_PI ? halfW - r : -halfW + r;
      let y = a < PI ? halfH - r : -halfH + r;
      g.vertex(x + r * cos(a), y + r * sin(a));
    }
    g.endShape(CLOSE);
    g.pop();
  }
  g.beginShape(TRIANGLE_STRIP);
  for (let i = 0; i <= steps; i++) {
    let a = map(i, 0, steps, 0, TWO_PI);
    let x = a < HALF_PI || a > 3 * HALF_PI ? halfW - r : -halfW + r;
    let y = a < PI ? halfH - r : -halfH + r;
    let px = x + r * cos(a), py = y + r * sin(a);
    g.vertex(px, py, halfD);
    g.vertex(px, py, -halfD);
  }
  g.endShape();
}

// NOTE: no longer called by draw() — see note above drawExtrudedRoundedRect().
function drawBorder(g, w, h, depth, r) {
  let halfW = w / 2, halfH = h / 2, halfD = depth / 2, steps = 40;
  for (let z of [-halfD, halfD]) {
    g.push();
    g.translate(0, 0, z);
    g.beginShape();
    for (let i = 0; i <= steps; i++) {
      let a = map(i, 0, steps, 0, TWO_PI);
      let x = a < HALF_PI || a > 3 * HALF_PI ? halfW - r : -halfW + r;
      let y = a < PI ? halfH - r : -halfH + r;
      g.vertex(x + r * cos(a), y + r * sin(a));
    }
    g.endShape(CLOSE);
    g.pop();
  }
}

// TO SHOW PI AS TEXT
const NAMED_CONSTANTS = {
  TWO_PI: Math.PI * 2,
  QUARTER_PI: Math.PI / 4,
  HALF_PI: Math.PI / 2,
  PI: Math.PI,
};
// longest names first so PI doesn't get matched as a substring pass before TWO_PI/HALF_PI/QUARTER_PI
const NAMED_CONSTANT_NAMES = Object.keys(NAMED_CONSTANTS).sort((a, b) => b.length - a.length);

function constNameForValue(v) {
  if (typeof v !== "number") return null;
  const eps = 1e-9;
  for (let name of NAMED_CONSTANT_NAMES) {
    if (Math.abs(v - NAMED_CONSTANTS[name]) < eps) return name;
  }
  return null;
}

function stringifyBoxPresetRaw(raw) {
  let replacer = (key, value) => {
    let name = constNameForValue(value);
    return name ? `__CONST_${name}__` : value;
  };
  let json = JSON.stringify(raw, replacer, 2);
  // unquote the placeholders so they read as bare identifiers, e.g. "rotX": TWO_PI
  return json.replace(/"__CONST_(\w+)__"/g, "$1");
}

function parseBoxPresetText(text) {
  let replaced = text;
  for (let name of NAMED_CONSTANT_NAMES) {
    let re = new RegExp(`\\b${name}\\b`, "g");
    replaced = replaced.replace(re, String(NAMED_CONSTANTS[name]));
  }
  return JSON.parse(replaced);
}

function resolveConstExpr(value) {
  if (typeof value !== "string") return value;
  let m = value.trim().match(/^(\w+)\s*(?:([+-])\s*([\d.]+))?$/);
  if (!m) return Number(value);
  let [, name, sign, num] = m;
  if (!(name in NAMED_CONSTANTS)) return Number(value);
  let base = NAMED_CONSTANTS[name];
  if (sign && num) base = sign === "+" ? base + Number(num) : base - Number(num);
  return base;
}

function resolveBoxPresetJson(jsonArr) {
  return jsonArr.map((entry) => {
    let resolved = {};
    for (let key in entry) resolved[key] = resolveConstExpr(entry[key]);
    return resolved;
  });
}

function makeStepButton(index, elapsedMs, onClick, isSelected) {
  let btn = document.createElement("button");
  btn.className = "step-btn";
  btn.style.display = "flex";
  btn.style.flexDirection = "column";
  btn.style.alignItems = "center";
  btn.style.background = "transparent";
  btn.style.border = isSelected ? "2px solid #ff6f00" : "2px solid transparent";
  btn.style.borderRadius = "4px";
  btn.style.boxSizing = "border-box";
  btn.style.cursor = "pointer";
  btn.style.width = 80;
  btn.style.height = 80;
  btn.style.position = "relative";
  
  let lbl = document.createElement("span");
  lbl.textContent = `${index}`;
  lbl.style.fontSize = "10px";
  lbl.style.color = "#ccc";
  lbl.style.position = "absolute";
  lbl.style.right = "6px";
  lbl.style.top = "2px";


  btn.appendChild(lbl);

  let thumb = document.createElement("img");
  thumb.className = "step-thumb";

  thumb.width = 80;
  thumb.height = 80;
  
  
  thumb.style.objectFit = "cover";
  thumb.style.borderRadius = "2px";
  // thumb.src = renderThumbnailDataURL(elapsedMs);
  btn.appendChild(thumb);

  btn.addEventListener("click", onClick);
  return btn;
}

function rebuildBoxStepButtons() {
  boxStepBtnContainerEl.innerHTML = "";
  boxStepBtnContainerEl.style.display = "flex";
  boxStepBtnContainerEl.style.flexDirection = "column";
  boxStepBtnContainerEl.style.margin = 0;
  boxStepBtnContainerEl.style.padding = 0;

  for (let i = 0; i < boxPreset.length; i++) {
    let elapsedMs = boxTimelineBar ? stepArrivalTime(boxTimelineBar.segs, i) : 0;
    let isSelected = lastSelectedStepKind === "box" && i === lastSelectedStepIndex;
    boxStepBtnContainerEl.appendChild(makeStepButton(i, elapsedMs, () => showBoxStep(i), isSelected));
  }
}

function rebuildCursorStepButtons() {
  cursorStepBtnContainerEl.innerHTML = "";
  cursorStepBtnContainerEl.style.display = "flex";
  cursorStepBtnContainerEl.style.flexDirection = "column";

  for (let i = 0; i < presets.length; i++) {
    let elapsedMs = cursorTimelineBar ? stepArrivalTime(cursorTimelineBar.segs, i) : 0;
    let isSelected = lastSelectedStepKind === "cursor" && i === lastSelectedStepIndex;
    cursorStepBtnContainerEl.appendChild(makeStepButton(i, elapsedMs, () => showCursorStep(i), isSelected));
  }
}

// EASINGS
function loadEasings() {
  function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

  function easeInOutQuad(x) {
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  }
  function linear(t) {
    return t;
  }
  function easeOutElastic(t, magnitude = 0.4) {
    const p = 1 - magnitude;
    const scaledTime = t;
    if (t === 0 || t === 1) {
      return t;
    }
    const s = (p / (2 * Math.PI)) * Math.asin(1);
    return (
      Math.pow(2, -10 * scaledTime) *
        Math.sin(((scaledTime - s) * (2 * Math.PI)) / p) +
      1
    );
  }
  function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }
  function overshoot(t, strength = 0.5) {
    const c1 = 1.70158 * strength;
    const c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * Math.pow(x, 3) + c1 * Math.pow(x, 2);
  }
  function bounce(t, bounces = 3, strength = 0.4) {
    const n = Math.max(1, Math.round(bounces));
    const segLen = [1];
    for (let i = 1; i < n; i++) {
      segLen.push(i === 1 ? 1 : segLen[i - 1] * 0.5);
    }
    const total = segLen.reduce((a, b) => a + b, 0);
    const n1 = total * total;
    const tUnit = t * total;
    let segStart = 0;
    let segIndex = 0;
    for (let i = 0; i < n; i++) {
      if (tUnit < segStart + segLen[i] || i === n - 1) {
        segIndex = i;
        break;
      }
      segStart += segLen[i];
    }
    if (segIndex === 0) {
      return n1 * t * t;
    }
    const floor = 1 - Math.pow(4, -segIndex);
    const vertexT = (segStart + segLen[segIndex] / 2) / total;
    const x = t - vertexT;
    const b = n1 * x * x + floor;
    return 1 - (1 - b) * strength;
  }
  return {
    Smooth: easeInOutQuad,
    Sine: easeInOutSine,   // add this
    Snappy: easeOutExpo,
    Elastic: easeOutElastic,
    Overshoot: overshoot,
    Bounce: bounce,
    Linear: linear,
  };
}

function applyEasing(t) {
  let fn = easings && easingSelect ? easings[easingSelect.value] : null;
  return typeof fn === "function" ? fn(t) : t;
}