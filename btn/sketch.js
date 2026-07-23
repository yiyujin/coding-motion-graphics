let w = 330, h = 120, d = 20, r = 60;

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

// Unified seeking state — replaces the old isBoxPreviewMode / isCursorPreviewMode split.
// When isSeeking is true, both the box and the cursor render whatever their
// interpolated state would be at seekElapsedMs on the shared timeline.
let isSeeking = false;
let seekElapsedMs = 0;

let rawBoxPreset = [];
let defaultBoxPresetRaw = [];

let masterPath = [];
let presets = [];
let isCursorPlaying = false;
let isCursorFinished = false;
let cursorPlayIndex = 0;
let cursorStartTime = 0;
let cursorHoldStart = 0;
let cursorIsHolding = false;
// Angle-smoothing state for the *live* cursor icon (the one driven by
// animateCursor() / the seek preview). Kept in an object (rather than a bare
// variable) so the thumbnail renderer can use its own separate ref and never
// disturb this one.
let liveCursorAngleRef = { value: null };
let cursorPlaybackClockStart = 0;
const ANGLE_SMOOTHING = 0.18;

// Offscreen buffer + its own angle-smoothing ref, used only for generating
// step-button thumbnails.
let thumbBuffer;
let thumbCursorAngleRef = { value: null };
const THUMB_SIZE = 600; // same resolution as the real canvas, so thumbnails are pixel-accurate; scaled down visually via <img> width/height

let boxTimelineBar, cursorTimelineBar;
let boxSceneLabel, cursorSceneLabel;

let selectedComponent = "box"; // "box" | "cursor" — determines which step numeric keys control


// LOAD DATA
let initialBoxPresetJson = [];
let rawCursorPresets = [];

const cw = 7, cyy = 16, cw2 = 1.5;
const CURSOR_POINTS = [
  { x: 0, y: 0 },
  { x: cw, y: cyy },
  { x: cw2, y: cyy - cw2 },
  { x: cw2, y: cyy + 4 },
  { x: -cw2, y: cyy + 4 },
  { x: -cw2, y: cyy - cw2 },
  { x: -cw, y: cyy },
];
let CURSOR_TIP_ANGLE;

let txtInputEl, sldLightXEl, sldLightYEl, sldIntensityEl, colorPickerEl, chkVisualizeEl, chkShowPathEl;
let boxStepBtnContainerEl, boxStepInfoDivEl, cursorStepBtnContainerEl, cursorStepInfoDivEl;
let txtBoxPresetEl, boxPresetErrorDivEl, txtCursorPresetsEl, cursorPresetErrorDivEl;
let timelineContainerDivEl;
let sharedPlayhead;

function preload(){
  font = loadFont("Roboto-Regular.ttf");
};

function getShapeTipAngle(points) {
  let xs = points.map((p) => p.x);
  let ys = points.map((p) => p.y);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  let centerX = minX + (maxX - minX) / 2;
  let centerY = minY + (maxY - minY) / 2;
  let tip = points[0];
  return atan2(tip.y - centerY, tip.x - centerX);
}

function lerpAngle(current, target, amt) {
  let diff = ((((target - current + PI) % TWO_PI) + TWO_PI) % TWO_PI) - PI;
  return current + diff * amt;
}

function normalizeBoxPreset(p) {
  p = p || {};
  return {
    rotX: typeof p.rotX === "number" ? p.rotX : 0,
    rotY: typeof p.rotY === "number" ? p.rotY : 0,
    rotZ: typeof p.rotZ === "number" ? p.rotZ : 0,
    zoom: typeof p.zoom === "number" ? p.zoom : 1000,
    lightX: typeof p.lightX === "number" ? p.lightX : 0,
    lightY: typeof p.lightY === "number" ? p.lightY : 0,
    intensity: typeof p.intensity === "number" ? p.intensity : 235,
    ms: typeof p.ms === "number" ? p.ms : 0,
    hold: typeof p.hold === "number" ? p.hold : 0,
  };
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

function setup() {
  let cnv = createCanvas(600, 600, WEBGL);
  document.getElementById("canvas-container").appendChild(cnv.elt);

  rawBoxPreset = initialBoxPreset.map(normalizeBoxPreset);
  boxPreset = buildBoxPresetFromRaw(rawBoxPreset);
  defaultBoxPresetRaw = JSON.parse(JSON.stringify(rawBoxPreset));

  textFont(font);

  thumbBuffer = createGraphics(THUMB_SIZE, THUMB_SIZE, WEBGL);
  thumbBuffer.textFont(font);

  CURSOR_TIP_ANGLE = getShapeTipAngle(CURSOR_POINTS);

  txtInputEl = document.getElementById("txtInput");
  sldLightXEl = document.getElementById("sldLightX");
  sldLightYEl = document.getElementById("sldLightY");
  sldIntensityEl = document.getElementById("sldIntensity");
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

  // Easing setup — loadEasings() returns a name -> function map; the select
  // element lets the user choose which curve shapes every MOVE-phase
  // progress value (box rotation/zoom/light AND cursor path/scale/twist).
  easings = loadEasings();
  easingSelect = document.getElementById("selEasing");

  rawBoxPreset = initialBoxPreset.map(normalizeBoxPreset);
  boxPreset = buildBoxPresetFromRaw(rawBoxPreset);
  defaultBoxPresetRaw = JSON.parse(JSON.stringify(rawBoxPreset));

  masterPath = initialMasterPath.map((p) => ({ x: p.x, y: p.y }));
  rawCursorPresets = initialCursorPresets.map((p) => normalizeRawCursorPreset(p));
  presets = buildCursorPresetsFromRaw(rawCursorPresets);

  txtBoxPresetEl.value = stringifyBoxPresetRaw(rawBoxPreset);
  txtCursorPresetsEl.value = JSON.stringify(rawCursorPresets, null, 2);

  document.getElementById("btnAnim").addEventListener("click", toggleBoth);
  document.getElementById("btnApplyBox").addEventListener("click", applyBoxPresets);
  document.getElementById("btnResetBox").addEventListener("click", resetBoxPresets);
  document.getElementById("btnApplyCursor").addEventListener("click", applyCursorPresets);
  document.getElementById("btnResetCursor").addEventListener("click", resetCursorPresets);

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
  thumb.src = renderThumbnailDataURL(elapsedMs);
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
  isSeeking = false;

  buildTimeline();
  rebuildBoxStepButtons();
  rebuildCursorStepButtons();
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

  isCursorPlaying = false;
  isCursorFinished = false;
  cursorPlayIndex = 0;
  cursorStartTime = 0;
  liveCursorAngleRef.value = null;
  isSeeking = false;
  cursorPlaybackClockStart = 0;

  buildTimeline();
  rebuildBoxStepButtons();
  rebuildCursorStepButtons();
}

function resetCursorPresets() {
  rawCursorPresets = initialCursorPresets.map((p) => normalizeRawCursorPreset(p));
  txtCursorPresetsEl.value = JSON.stringify(rawCursorPresets, null, 2);
  cursorPresetErrorDivEl.textContent = "";
  applyCursorPresets();
}

// Returns the elapsed ms at which the animation actually *arrives* at step i
// (i.e. the moment its hold phase begins).
function stepArrivalTime(segs, i) {
  if (!segs || segs.length === 0) return 0;
  let idx = constrain(i, 0, segs.length - 1);
  return segs[idx].segStart + segs[idx].firstDur;
}

// Computes the box's interpolated state at any elapsed ms on the shared timeline.
function computeBoxValueAtElapsed(elapsedMs) {
  let status = sceneStatusAtElapsed(boxTimelineBar.segs, elapsedMs);
  if (!status) return { ...boxPreset[0] };

  if (status.phase === "END") return { ...boxPreset[boxPreset.length - 1] };

  if (status.phase === "HOLD") {
    return { ...boxPreset[status.index] };
  }

  // MOVE phase: transitioning from the previous step into status.index
  let p0 = boxPreset[Math.max(0, status.index - 1)];
  let p1 = boxPreset[status.index];
  let progress = status.phaseDur > 0 ? constrain(status.phaseElapsed / status.phaseDur, 0, 1) : 1;
  progress = applyEasing(progress);

  return {
    rotX: lerp(p0.rotX, p1.rotX, progress),
    rotY: lerp(p0.rotY, p1.rotY, progress),
    rotZ: lerp(p0.rotZ, p1.rotZ, progress),
    zoom: lerp(p0.zoom, p1.zoom, progress),
    lightX: lerp(p0.lightX, p1.lightX, progress),
    lightY: lerp(p0.lightY, p1.lightY, progress),
    intensity: lerp(p0.intensity, p1.intensity, progress),
  };
}

// Computes the cursor's interpolated state at any elapsed ms on the shared timeline.
function computeCursorValueAtElapsed(elapsedMs) {
  if (presets.length === 0) return null;
  let status = sceneStatusAtElapsed(cursorTimelineBar.segs, elapsedMs);
  if (!status) {
    let first = presets[0];
    return { x: first.x, y: first.y, dx: 0, dy: 0, scale: first.scale, angleTwist: first.angleTwist,
             rotX: first.rotX, rotY: first.rotY, rotZ: first.rotZ, cameraZoom: first.cameraZoom };
  }

  if (status.phase === "END") {
    let last = presets[presets.length - 1];
    return { x: last.x, y: last.y, dx: 0, dy: 0, scale: last.scale, angleTwist: last.angleTwist,
             rotX: last.rotX, rotY: last.rotY, rotZ: last.rotZ, cameraZoom: last.cameraZoom };
  }

  if (status.phase === "HOLD") {
    let p1 = presets[status.index];
    let p2 = presets[Math.min(status.index + 1, presets.length - 1)];
    return { x: p1.x, y: p1.y, dx: p2.x - p1.x, dy: p2.y - p1.y, scale: p1.scale,
             angleTwist: p1.angleTwist, rotX: p1.rotX, rotY: p1.rotY, rotZ: p1.rotZ,
             cameraZoom: p1.cameraZoom };
  }

  // MOVE phase: transitioning from the previous step into status.index
  let p1 = presets[Math.max(0, status.index - 1)];
  let p2 = presets[status.index];
  let progress = status.phaseDur > 0 ? constrain(status.phaseElapsed / status.phaseDur, 0, 1) : 1;
  progress = applyEasing(progress);

  let rawIdx = map(progress, 0, 1, p1.pathIndex, p2.pathIndex);
  let low = floor(rawIdx);
  let high = ceil(rawIdx);
  let t = rawIdx - low;

  let pA = masterPath[constrain(low, 0, masterPath.length - 1)];
  let pB = masterPath[constrain(high, 0, masterPath.length - 1)];
  let posX = lerp(pA.x, pB.x, t);
  let posY = lerp(pA.y, pB.y, t);

  let dx, dy;
  if (p1.pathIndex === p2.pathIndex) {
    dx = 0;
    dy = 0;
  } else {
    const DIR_LOOKAHEAD = 4;
    let behind = masterPath[constrain(low - DIR_LOOKAHEAD, 0, masterPath.length - 1)];
    let ahead = masterPath[constrain(high + DIR_LOOKAHEAD, 0, masterPath.length - 1)];
    dx = ahead.x - behind.x;
    dy = ahead.y - behind.y;
    if (dx === 0 && dy === 0) {
      dx = p2.x - p1.x;
      dy = p2.y - p1.y;
    }
  }

  return {
    x: posX, y: posY, dx, dy,
    scale: lerp(p1.scale, p2.scale, progress),
    angleTwist: lerp(p1.angleTwist, p2.angleTwist, progress),
    rotX: lerp(p1.rotX, p2.rotX, progress),
    rotY: lerp(p1.rotY, p2.rotY, progress),
    rotZ: lerp(p1.rotZ, p2.rotZ, progress),
    cameraZoom: p2.cameraZoom,
  };
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

  let bv = computeBoxValueAtElapsed(seekElapsedMs);
  sldLightXEl.value = bv.lightX;
  sldLightYEl.value = bv.lightY;
  sldIntensityEl.value = bv.intensity;

  updateBoxStepInfo(i);

  let cStatus = sceneStatusAtElapsed(cursorTimelineBar.segs, seekElapsedMs);
  if (cStatus) {
    cursorPreviewStepIndex = cStatus.index;
    updateCursorStepInfo(cStatus.index);
  }
}

function updateBoxStepInfo(i) {
  let bp = boxPreset[i];
  let lines = [];
  lines.push(`BOX STEP ${i}`);
  lines.push(`rotX ${bp.rotX.toFixed(2)}  rotY ${bp.rotY.toFixed(2)}  rotZ ${bp.rotZ.toFixed(2)}`);
  lines.push(`zoom ${bp.zoom}  light (${bp.lightX}, ${bp.lightY})  intensity ${bp.intensity}`);
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

  updateCursorStepInfo(i);

  let bStatus = sceneStatusAtElapsed(boxTimelineBar.segs, seekElapsedMs);
  if (bStatus) {
    boxPreviewStepIndex = bStatus.index;
    updateBoxStepInfo(bStatus.index);

    let bv = computeBoxValueAtElapsed(seekElapsedMs);
    sldLightXEl.value = bv.lightX;
    sldLightYEl.value = bv.lightY;
    sldIntensityEl.value = bv.intensity;
  }
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

  // buildTimelineTable(box.segs, timelineContainerDivEl, "Box");
  // buildTimelineTable(cursor.segs, timelineContainerDivEl, "Cursor");

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
    sldLightXEl.value = first.lightX;
    sldLightYEl.value = first.lightY;
    sldIntensityEl.value = first.intensity;
  }
}

function toggleCursor() {
  isSeeking = false;
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

function animateBox() {
  if (boxPlayIndex >= boxPreset.length - 1) {
    isAnimating = false;
    isBoxFinished = true;
    return { ...boxPreset[boxPreset.length - 1] };
  }

  let p1 = boxPreset[boxPlayIndex];
  let p2 = boxPreset[boxPlayIndex + 1];

  if (!boxIsHolding && boxAnimStart === 0) {
    boxIsHolding = true;
    boxHoldStart = millis();
  }

  if (boxIsHolding) {
    if (millis() - boxHoldStart >= p1.hold) {
      boxIsHolding = false;
      boxAnimStart = millis();
    }
    return { ...p1 };
  }

  let elapsed = millis() - boxAnimStart;
  let progress = p2.ms > 0 ? map(elapsed, 0, p2.ms, 0, 1, true) : 1;
  progress = applyEasing(progress);

  let v = {
    rotX: lerp(p1.rotX, p2.rotX, progress),
    rotY: lerp(p1.rotY, p2.rotY, progress),
    rotZ: lerp(p1.rotZ, p2.rotZ, progress),
    zoom: lerp(p1.zoom, p2.zoom, progress),
    lightX: lerp(p1.lightX, p2.lightX, progress),
    lightY: lerp(p1.lightY, p2.lightY, progress),
    intensity: lerp(p1.intensity, p2.intensity, progress),
  };

  if (progress >= 1) {
    boxPlayIndex++;
    boxIsHolding = true;
    boxHoldStart = millis();
    boxAnimStart = 0;
  }

  return v;
}

function drawCursorIcon(g, angleRef, x, y, dx, dy, scaleVal, angleTwist, rotX = 0, rotY = 0, rotZ = 0) {
  if (dx === 0 && dy === 0) {
    if (angleRef.value === null) angleRef.value = -CURSOR_TIP_ANGLE;
  } else {
    let theta = atan2(dy, dx);
    let targetAngle = theta - CURSOR_TIP_ANGLE;
    if (angleRef.value === null) angleRef.value = targetAngle;
    else angleRef.value = lerpAngle(angleRef.value, targetAngle, ANGLE_SMOOTHING);
  }

  g.push();
  g.translate(x, y, 0);
  g.rotateX(rotX);
  g.rotateY(rotY);
  g.rotateZ(angleRef.value + angleTwist + rotZ);
  g.scale(scaleVal);
  g.stroke(0);
  g.strokeWeight(4 / scaleVal);
  g.fill(255);
  g.beginShape();
  for (let p of CURSOR_POINTS) g.vertex(p.x, p.y);
  g.endShape(CLOSE);
  g.pop();
}

function animateCursor() {
  if (cursorPlayIndex >= presets.length - 1) {
    isCursorPlaying = false;
    isCursorFinished = true;
    return;
  }

  let p1 = presets[cursorPlayIndex];
  let p2 = presets[cursorPlayIndex + 1];

  if (!cursorIsHolding && cursorStartTime === 0) {
    cursorIsHolding = true;
    cursorHoldStart = millis();
  }

  if (cursorIsHolding) {
    drawCursorIcon(window, liveCursorAngleRef, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, p1.scale, p1.angleTwist, p1.rotX, p1.rotY, p1.rotZ);
    if (millis() - cursorHoldStart >= p1.hold) {
      cursorIsHolding = false;
      cursorStartTime = millis();
    }
    return;
  }

  let elapsed = millis() - cursorStartTime;
  let progress = p2.ms > 0 ? map(elapsed, 0, p2.ms, 0, 1, true) : 1;
  progress = applyEasing(progress);

  let rawIdx = map(progress, 0, 1, p1.pathIndex, p2.pathIndex);
  let low = floor(rawIdx);
  let high = ceil(rawIdx);
  let t = rawIdx - low;

  let pA = masterPath[constrain(low, 0, masterPath.length - 1)];
  let pB = masterPath[constrain(high, 0, masterPath.length - 1)];

  let posX = lerp(pA.x, pB.x, t);
  let posY = lerp(pA.y, pB.y, t);

  let dx, dy;
  if (p1.pathIndex === p2.pathIndex) {
    dx = 0;
    dy = 0;
  } else {
    const DIR_LOOKAHEAD = 4;
    let behind = masterPath[constrain(low - DIR_LOOKAHEAD, 0, masterPath.length - 1)];
    let ahead = masterPath[constrain(high + DIR_LOOKAHEAD, 0, masterPath.length - 1)];
    dx = ahead.x - behind.x;
    dy = ahead.y - behind.y;
    if (dx === 0 && dy === 0) {
      dx = p2.x - p1.x;
      dy = p2.y - p1.y;
    }
  }

  let currentScale = lerp(p1.scale, p2.scale, progress);
  let currentTwist = lerp(p1.angleTwist, p2.angleTwist, progress);
  let currentRotX = lerp(p1.rotX, p2.rotX, progress);
  let currentRotY = lerp(p1.rotY, p2.rotY, progress);
  let currentRotZ = lerp(p1.rotZ, p2.rotZ, progress);

  drawCursorIcon(window, liveCursorAngleRef, posX, posY, dx, dy, currentScale, currentTwist, currentRotX, currentRotY, currentRotZ);

  if (progress >= 1) {
    cursorPlayIndex++;
    cursorIsHolding = true;
    cursorHoldStart = millis();
    cursorStartTime = 0;
  }
}

function getCurrentCursorCameraZoom() {
  if (presets.length === 0) return false;
  if (isSeeking) {
    let cv = computeCursorValueAtElapsed(seekElapsedMs);
    return cv ? !!cv.cameraZoom : false;
  }
  if (isCursorPlaying) return !!presets[cursorPlayIndex].cameraZoom;
  if (isCursorFinished) return !!presets[presets.length - 1].cameraZoom;
  return !!presets[0].cameraZoom;
}

// Renders a single still frame of the combined scene (box + cursor) at the
// given elapsed ms on the shared timeline into the offscreen thumbnail
// buffer, and returns it as a data URL. Mirrors draw()'s logic but targets
// `thumbBuffer` instead of the live canvas, and uses its own angle-ref so it
// never disturbs the live cursor's smoothing state.
function renderThumbnailDataURL(elapsedMs) {
  if (!thumbBuffer) return "";
  let buf = thumbBuffer;

  buf.clear();
  buf.background(0);

  let bv = computeBoxValueAtElapsed(elapsedMs);

  buf.camera(0, 0, bv.zoom, 0, 0, 0, 0, 1, 0);
  buf.rotateX(bv.rotX);
  buf.rotateY(bv.rotY);
  buf.rotateZ(bv.rotZ);

  buf.ambientLight(50);
  buf.directionalLight(bv.intensity, bv.intensity, bv.intensity, bv.lightX, bv.lightY, 100);
  let col = color(colorPickerEl.value);
  buf.specularMaterial(red(col), green(col), blue(col));
  buf.shininess(50);

  buf.noStroke();
  buf.fill(255, 100);
  drawExtrudedRoundedRect(buf, w, h, d, r);
  buf.stroke(255, 10);
  buf.noFill();
  drawBorder(buf, w, h, d, r);

  buf.push();
  buf.fill(255);
  buf.noStroke();
  buf.textAlign(CENTER, CENTER);
  buf.textSize(40);
  buf.translate(0, 0, d / 2 + 1);
  buf.text(txtInputEl.value, 0, 0);
  buf.pop();

  let cv = computeCursorValueAtElapsed(elapsedMs);
  let cameraZoomFlag = cv ? !!cv.cameraZoom : false;
  if (!cameraZoomFlag) {
    buf.resetMatrix();
    buf.camera();
  }

  buf.noLights();
  buf.drawingContext.disable(buf.drawingContext.DEPTH_TEST);
  buf.push();
  buf.translate(-buf.width / 2, -buf.height / 2, 0);

  thumbCursorAngleRef.value = null; // fresh snap, no smoothing carried over between thumbnails
  if (cv) {
    drawCursorIcon(buf, thumbCursorAngleRef, cv.x, cv.y, cv.dx, cv.dy, cv.scale, cv.angleTwist, cv.rotX, cv.rotY, cv.rotZ);
  }

  buf.pop();
  buf.drawingContext.enable(buf.drawingContext.DEPTH_TEST);

  return buf.elt.toDataURL();
}

function draw() {
  background(0);
  updateTimelinePlayheads();

  let targetRotX = 0, targetRotY = 0, targetRotZ = 0, targetZoom = boxPreset[0].zoom;
  let targetLX = Number(sldLightXEl.value), targetLY = Number(sldLightYEl.value), targetInt = Number(sldIntensityEl.value);

  if (isSeeking) {
    let bv = computeBoxValueAtElapsed(seekElapsedMs);
    targetRotX = bv.rotX;
    targetRotY = bv.rotY;
    targetRotZ = bv.rotZ;
    targetZoom = bv.zoom;
    targetLX = bv.lightX;
    targetLY = bv.lightY;
    targetInt = bv.intensity;
    sldLightXEl.value = targetLX;
    sldLightYEl.value = targetLY;
    sldIntensityEl.value = targetInt;
  } else if (isAnimating) {
    let v = animateBox();
    targetRotX = v.rotX;
    targetRotY = v.rotY;
    targetRotZ = v.rotZ;
    targetZoom = v.zoom;
    targetLX = v.lightX;
    targetLY = v.lightY;
    targetInt = v.intensity;
    sldLightXEl.value = targetLX;
    sldLightYEl.value = targetLY;
    sldIntensityEl.value = targetInt;
  } else if (isBoxFinished) {
    let last = boxPreset[boxPreset.length - 1];
    targetRotX = last.rotX;
    targetRotY = last.rotY;
    targetRotZ = last.rotZ;
    targetZoom = last.zoom;
    targetLX = last.lightX;
    targetLY = last.lightY;
    targetInt = last.intensity;
  } else {
    let first = boxPreset[0];
    targetRotX = first.rotX;
    targetRotY = first.rotY;
    targetRotZ = first.rotZ;
    targetZoom = first.zoom;
  }

  camera(0, 0, targetZoom, 0, 0, 0, 0, 1, 0);
  rotateX(targetRotX);
  rotateY(targetRotY);
  rotateZ(targetRotZ);

  ambientLight(50);
  directionalLight(targetInt, targetInt, targetInt, targetLX, targetLY, 100);
  let col = color(colorPickerEl.value);
  specularMaterial(red(col), green(col), blue(col));
  shininess(50);

  noStroke();
  fill(255, 100);
  drawExtrudedRoundedRect(window, w, h, d, r);
  stroke(255, 10);
  noFill();
  drawBorder(window, w, h, d, r);

  push();
  fill(255);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(40);
  translate(0, 0, d / 2 + 1);
  text(txtInputEl.value, 0, 0);
  pop();

  if (chkVisualizeEl.checked) {
    push();
    stroke(255, 0, 0);
    strokeWeight(2);
    line(targetLX, targetLY, 100, 0, 0, 0);
    translate(targetLX, targetLY, 100);
    fill(255, 0, 0);
    noStroke();
    sphere(10);
    pop();
  }

  let cursorCameraZoom = getCurrentCursorCameraZoom();
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

  if (isSeeking) {
    let cv = computeCursorValueAtElapsed(seekElapsedMs);
    if (cv) drawCursorIcon(window, liveCursorAngleRef, cv.x, cv.y, cv.dx, cv.dy, cv.scale, cv.angleTwist, cv.rotX, cv.rotY, cv.rotZ);
  } else {
    if (isCursorPlaying) animateCursor();
    if (isCursorFinished) {
      let last = presets[presets.length - 1];
      drawCursorIcon(window, liveCursorAngleRef, last.x, last.y, 0, 0, last.scale, last.angleTwist, last.rotX, last.rotY, last.rotZ);
    } else if (!isCursorPlaying && !isCursorFinished && presets.length > 0) {
      let first = presets[0];
      drawCursorIcon(window, liveCursorAngleRef, first.x, first.y, 0, 0, first.scale, first.angleTwist, first.rotX, first.rotY, first.rotZ);
    }
  }

  pop();
  drawingContext.enable(drawingContext.DEPTH_TEST);
}

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

function makeStepButton(index, elapsedMs, onClick) {
  let btn = document.createElement("button");
  btn.className = "step-btn";
  btn.style.display = "flex";
  btn.style.flexDirection = "column";
  btn.style.alignItems = "center";
  btn.style.background = "transparent";
  btn.style.border = "none";
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
  thumb.src = renderThumbnailDataURL(elapsedMs);
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
    boxStepBtnContainerEl.appendChild(makeStepButton(i, elapsedMs, () => showBoxStep(i)));
  }
}

function rebuildCursorStepButtons() {
  cursorStepBtnContainerEl.innerHTML = "";
  cursorStepBtnContainerEl.style.display = "flex";
  cursorStepBtnContainerEl.style.flexDirection = "column";

  for (let i = 0; i < presets.length; i++) {
    let elapsedMs = cursorTimelineBar ? stepArrivalTime(cursorTimelineBar.segs, i) : 0;
    cursorStepBtnContainerEl.appendChild(makeStepButton(i, elapsedMs, () => showCursorStep(i)));
  }
}


// EASINGS
function loadEasings() {
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
    Snappy: easeOutExpo,
    Elastic: easeOutElastic,
    Overshoot: overshoot,
    Bounce: bounce,
    Linear: linear,
  };
}

let easings;
let easingSelect;

function applyEasing(t) {
  let fn = easings && easingSelect ? easings[easingSelect.value] : null;
  return typeof fn === "function" ? fn(t) : t;
}