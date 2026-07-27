const HAND_CURSOR_PATH_D =
  "M11.3,20.4c-0.3-0.4-0.6-1.1-1.2-2c-0.3-0.5-1.2-1.5-1.5-1.9c-0.2-0.4-0.2-0.6-0.1-1c0.1-0.6,0.7-1.1,1.4-1.1c0.5,0,1,0.4,1.4,0.7c0.2,0.2,0.5,0.6,0.7,0.8c0.2,0.2,0.2,0.3,0.4,0.5c0.2,0.3,0.3,0.5,0.2,0.1c-0.1-0.5-0.2-1.3-0.4-2.1c-0.1-0.6-0.2-0.7-0.3-1.1c-0.1-0.5-0.2-0.8-0.3-1.3c-0.1-0.3-0.2-1.1-0.3-1.5c-0.1-0.5-0.1-1.4,0.3-1.8c0.3-0.3,0.9-0.4,1.3-0.2c0.5,0.3,0.8,1,0.9,1.3c0.2,0.5,0.4,1.2,0.5,2c0.2,1,0.5,2.5,0.5,2.8c0-0.4-0.1-1.1,0-1.5c0.1-0.3,0.3-0.7,0.7-0.8c0.3-0.1,0.6-0.1,0.9-0.1c0.3,0.1,0.6,0.3,0.8,0.5c0.4,0.6,0.4,1.9,0.4,1.8c0.1-0.4,0.1-1.2,0.3-1.6c0.1-0.2,0.5-0.4,0.7-0.5c0.3-0.1,0.7-0.1,1,0c0.2,0,0.6,0.3,0.7,0.5c0.2,0.3,0.3,1.3,0.4,1.7c0,0.1,0.1-0.4,0.3-0.7c0.4-0.6,1.8-0.8,1.9,0.6c0,0.7,0,0.6,0,1.1c0,0.5,0,0.8,0,1.2c0,0.4-0.1,1.3-0.2,1.7c-0.1,0.3-0.4,1-0.7,1.4c0,0-1.1,1.2-1.2,1.8c-0.1,0.6-0.1,0.6-0.1,1c0,0.4,0.1,0.9,0.1,0.9s-0.8,0.1-1.2,0c-0.4-0.1-0.9-0.8-1-1.1c-0.2-0.3-0.5-0.3-0.7,0c-0.2,0.4-0.7,1.1-1.1,1.1c-0.7,0.1-2.1,0-3.1,0c0,0,0.2-1-0.2-1.4c-0.3-0.3-0.8-0.8-1.1-1.1L11.3,20.4z";

const HAND_FINGER_LINES_SVG = [
  { x1: 19.6, y1: 20.7, x2: 19.6, y2: 17.3 },
  { x1: 17.6, y1: 20.7, x2: 17.5, y2: 17.3 },
  { x1: 15.6, y1: 17.3, x2: 15.6, y2: 20.7 },
];

const cw = 7, cyy = 16, cw2 = 1.5;

// Cursor shape definitions — three selectable types.
const CURSOR_POINTS_ROUNDED = [
  { x: 0, y: 0 },
  { x: cw, y: cyy },
  { x: cw2, y: cyy - cw2 },
  { x: cw2, y: cyy + 4 },
  { x: -cw2, y: cyy + 4 },
  { x: -cw2, y: cyy - cw2 },
  { x: -cw, y: cyy },
];

const CURSOR_POINTS_ARROW = [
  { x: 0, y: 0 },
  { x: cw, y: cyy },
  { x: 0, y: cyy - 3 },
  { x: -cw, y: cyy },
];

// Populated by initCursorTypes().
let HAND_POINTS = [];
let HAND_FINGER_LINES = [];
let CURSOR_TIP_ANGLE_ROUNDED;
let CURSOR_TIP_ANGLE_ARROW;

function sampleSvgPathPoints(pathData, numPoints = 120) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", pathData);
  svg.appendChild(path);
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";
  document.body.appendChild(svg); // must be in the DOM for getPointAtLength to be reliable

  const totalLength = path.getTotalLength();
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    const pt = path.getPointAtLength((i / numPoints) * totalLength);
    points.push({ x: pt.x, y: pt.y });
  }

  document.body.removeChild(svg);
  return points;
}

function getPointsBounds(points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

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

// Call once from setup(), after the canvas/DOM exist. Samples the hand SVG
// path into points, re-centers everything around its own bounding-box
// center, and precomputes the "tip angle" for the two point-array shapes.
function initCursorTypes() {
  HAND_POINTS = sampleSvgPathPoints(HAND_CURSOR_PATH_D, 120);

  let allPts = HAND_POINTS.concat(
    HAND_FINGER_LINES_SVG.flatMap((l) => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }])
  );
  let b = getPointsBounds(allPts);
  let anchorX = b.minX + (b.maxX - b.minX) / 2;
  let anchorY = b.minY + (b.maxY - b.minY) / 2;

  HAND_POINTS = HAND_POINTS.map((p) => ({ x: p.x - anchorX, y: p.y - anchorY }));
  HAND_FINGER_LINES = HAND_FINGER_LINES_SVG.map((l) => ({
    x1: l.x1 - anchorX, y1: l.y1 - anchorY,
    x2: l.x2 - anchorX, y2: l.y2 - anchorY,
  }));

  CURSOR_TIP_ANGLE_ROUNDED = getShapeTipAngle(CURSOR_POINTS_ROUNDED);
  CURSOR_TIP_ANGLE_ARROW = getShapeTipAngle(CURSOR_POINTS_ARROW);
}

// Draws the cursor icon for whichever shape is selected via `cursorType`
// ("rounded" | "arrow" | "hand"). "rounded"/"arrow" are point-array shapes
// sharing the same rotate/scale logic; "hand" uses the SVG-sampled hand
// outline with its own angle convention (no tip-angle offset — the hand
// shape isn't tip-first like the pointer shapes, so it orients directly
// along the direction of travel).
function drawCursorIcon(g, angleRef, x, y, dx, dy, scaleVal, angleTwist, rotX = 0, rotY = 0, rotZ = 0, cursorType = "arrow") {
  if (cursorType === "hand") {
    drawHandCursorIcon(g, angleRef, x, y, dx, dy, scaleVal, angleTwist, rotX, rotY, rotZ);
    return;
  }

  let points = cursorType === "rounded" ? CURSOR_POINTS_ROUNDED : CURSOR_POINTS_ARROW;
  let tipAngle = cursorType === "rounded" ? CURSOR_TIP_ANGLE_ROUNDED : CURSOR_TIP_ANGLE_ARROW;

  if (dx === 0 && dy === 0) {
    if (angleRef.value === null) angleRef.value = -tipAngle;
  } else {
    let theta = atan2(dy, dx);
    let targetAngle = theta - tipAngle;
    if (angleRef.value === null) angleRef.value = targetAngle;
    else angleRef.value = lerpAngle(angleRef.value, targetAngle, ANGLE_SMOOTHING);
  }

  // CURSOR STROKE WIDTH
  let csw = 2;

  g.push();
  g.translate(x, y, 0);
  g.rotateX(rotX);
  g.rotateY(rotY);
  g.rotateZ(angleRef.value + angleTwist + rotZ);
  g.scale(scaleVal);

  // BLACK 
  g.stroke(255);
  g.strokeWeight(1/2 * scaleVal * csw);
  g.fill(0);

  //WHITE
    g.stroke(0);
    g.fill(255);

  g.beginShape();
  for (let p of points) g.vertex(p.x, p.y);
  g.endShape(CLOSE);
  g.pop();
}

function drawHandCursorIcon(g, angleRef, x, y, dx, dy, scaleVal, angleTwist, rotX = 0, rotY = 0, rotZ = 0) {
  if (dx === 0 && dy === 0) {
    if (angleRef.value === null) angleRef.value = 0;
  } else {
    let targetAngle = atan2(dy, dx);
    if (angleRef.value === null) angleRef.value = targetAngle;
    else angleRef.value = lerpAngle(angleRef.value, targetAngle, ANGLE_SMOOTHING);
  }

  g.push();
  g.translate(x, y, 0);
  g.rotateX(rotX);
  g.rotateY(rotY);
  g.rotateZ(angleRef.value + angleTwist + rotZ + HALF_PI);
  g.scale(scaleVal * 0.6);

  // hand outline — white fill, black stroke
  g.stroke(0);
  g.strokeWeight(0.75 * scaleVal);
  g.fill(255);
  g.beginShape();
  for (let p of HAND_POINTS) g.vertex(p.x, p.y);
  g.endShape(CLOSE);

  // finger crease lines
  g.stroke(0);
  g.strokeWeight(0.75 * scaleVal);
  g.noFill();
  for (let l of HAND_FINGER_LINES) g.line(l.x1, l.y1, l.x2, l.y2);

  g.pop();
}