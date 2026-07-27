/**
 * Custom text extrusion for p5.js with bevel support and proper smooth normals
 * Based on Three.js ExtrudeGeometry approach
 */

// Earcut triangulation - minimal implementation
// Based on https://github.com/mapbox/earcut
function earcut(data, holeIndices, dim = 2) {
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles = [];

  if (!outerNode || outerNode.next === outerNode.prev) return triangles;

  let minX, minY, maxX, maxY, x, y, invSize;

  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);

  if (data.length > 80 * dim) {
    minX = maxX = data[0];
    minY = maxY = data[1];

    for (let i = dim; i < outerLen; i += dim) {
      x = data[i];
      y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }

  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);

  return triangles;
}

function linkedList(data, start, end, dim, clockwise) {
  let last;

  if (clockwise === signedArea(data, start, end, dim) > 0) {
    for (let i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
  }

  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }

  if (last) {
    last.next.prev = last;
    last.prev.next = last;
  }

  return last;
}

function filterPoints(start, end) {
  if (!start) return start;
  if (!end) end = start;

  let p = start, again;
  do {
    again = false;

    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== end);

  return end;
}

function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
  if (!ear) return;

  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

  let stop = ear, prev, next;

  while (ear.prev !== ear.next) {
    prev = ear.prev;
    next = ear.next;

    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i / dim | 0);
      triangles.push(ear.i / dim | 0);
      triangles.push(next.i / dim | 0);

      removeNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }

    ear = next;

    if (ear === stop) {
      if (!pass) {
        earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
      } else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
        earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
      } else if (pass === 2) {
        splitEarcut(ear, triangles, dim, minX, minY, invSize);
      }
      break;
    }
  }
}

function isEar(ear) {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;

  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  const x0 = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx),
    y0 = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy),
    x1 = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx),
    y1 = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);

  let p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}

function isEarHashed(ear, minX, minY, invSize) {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;

  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  const x0 = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx),
    y0 = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy),
    x1 = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx),
    y1 = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);

  const minZ = zOrder(x0, y0, minX, minY, invSize),
    maxZ = zOrder(x1, y1, minX, minY, invSize);

  let p = ear.prevZ, n = ear.nextZ;

  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }

  while (p && p.z >= minZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
  }

  while (n && n.z <= maxZ) {
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }

  return true;
}

function cureLocalIntersections(start, triangles, dim) {
  let p = start;
  do {
    const a = p.prev, b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i / dim | 0);
      triangles.push(p.i / dim | 0);
      triangles.push(b.i / dim | 0);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}

function splitEarcut(start, triangles, dim, minX, minY, invSize) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function eliminateHoles(data, holeIndices, outerNode, dim) {
  const queue = [];
  for (let i = 0, len = holeIndices.length; i < len; i++) {
    const start = holeIndices[i] * dim;
    const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    const list = linkedList(data, start, end, dim, false);
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort(compareX);
  for (let i = 0; i < queue.length; i++) {
    outerNode = eliminateHole(queue[i], outerNode);
  }
  return outerNode;
}

function compareX(a, b) { return a.x - b.x; }

function eliminateHole(hole, outerNode) {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}

function findHoleBridge(hole, outerNode) {
  let p = outerNode, qx = -Infinity, m;
  const hx = hole.x, hy = hole.y;

  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);

  if (!m) return null;

  const stop = m, mx = m.x, my = m.y;
  let tanMin = Infinity, tan;

  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) &&
        (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);

  return m;
}

function sectorContainsSector(m, p) {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

function indexCurve(start, minX, minY, invSize) {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);
  p.prevZ.nextZ = null;
  p.prevZ = null;
  sortLinked(p);
}

function sortLinked(list) {
  let i, p, q, e, tail, numMerges, pSize, qSize, inSize = 1;

  do {
    p = list;
    list = null;
    tail = null;
    numMerges = 0;

    while (p) {
      numMerges++;
      q = p;
      pSize = 0;
      for (i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ;
        if (!q) break;
      }
      qSize = inSize;

      while (pSize > 0 || (qSize > 0 && q)) {
        if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
          e = p; p = p.nextZ; pSize--;
        } else {
          e = q; q = q.nextZ; qSize--;
        }
        if (tail) tail.nextZ = e;
        else list = e;
        e.prevZ = tail;
        tail = e;
      }
      p = q;
    }
    tail.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);

  return list;
}

function zOrder(x, y, minX, minY, invSize) {
  x = (x - minX) * invSize | 0;
  y = (y - minY) * invSize | 0;
  x = (x | (x << 8)) & 0x00FF00FF;
  x = (x | (x << 4)) & 0x0F0F0F0F;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  y = (y | (y << 8)) & 0x00FF00FF;
  y = (y | (y << 4)) & 0x0F0F0F0F;
  y = (y | (y << 2)) & 0x33333333;
  y = (y | (y << 1)) & 0x55555555;
  return x | (y << 1);
}

function getLeftmost(start) {
  let p = start, leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py);
}

function isValidDiagonal(a, b) {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
    (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
      (area(a.prev, a, b.prev) || area(a, b.prev, b)) ||
      equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
}

function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
function equals(p1, p2) { return p1.x === p2.x && p1.y === p2.y; }

function intersects(p1, q1, p2, q2) {
  const o1 = signNum(area(p1, q1, p2));
  const o2 = signNum(area(p1, q1, q2));
  const o3 = signNum(area(p2, q2, p1));
  const o4 = signNum(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function onSegment(p, q, r) {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

function signNum(num) { return num > 0 ? 1 : num < 0 ? -1 : 0; }

function intersectsPolygon(a, b) {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
      intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}

function locallyInside(a, b) {
  return area(a.prev, a, a.next) < 0 ?
    area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
    area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a, b) {
  let p = a, inside = false;
  const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do {
    if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
      (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x))
      inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}

function splitPolygon(a, b) {
  const a2 = createNode(a.i, a.x, a.y),
    b2 = createNode(b.i, b.x, b.y),
    an = a.next, bp = b.prev;
  a.next = b; b.prev = a;
  a2.next = an; an.prev = a2;
  b2.next = a2; a2.prev = b2;
  bp.next = b2; b2.prev = bp;
  return b2;
}

function insertNode(i, x, y, last) {
  const p = createNode(i, x, y);
  if (!last) {
    p.prev = p; p.next = p;
  } else {
    p.next = last.next; p.prev = last;
    last.next.prev = p; last.next = p;
  }
  return p;
}

function removeNode(p) {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function createNode(i, x, y) {
  return { i, x, y, prev: null, next: null, z: 0, prevZ: null, nextZ: null, steiner: false };
}

function signedArea(data, start, end, dim) {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

// End of Earcut

// ============================================================================
// Geometry helpers
// ============================================================================

function isClockwise(vertices) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    sum += (v2.x - v1.x) * (v2.y + v1.y);
  }
  return sum > 0;
}

function triangulateShape(contour, holes) {
  const vertices = [];
  const holeIndices = [];

  for (let i = 0; i < contour.length; i++) {
    vertices.push(contour[i].x, contour[i].y);
  }

  for (let h = 0; h < holes.length; h++) {
    holeIndices.push(vertices.length / 2);
    const hole = holes[h];
    for (let i = 0; i < hole.length; i++) {
      vertices.push(hole[i].x, hole[i].y);
    }
  }

  const indices = earcut(vertices, holeIndices.length > 0 ? holeIndices : null, 2);
  const faces = [];
  for (let i = 0; i < indices.length; i += 3) {
    faces.push([indices[i], indices[i + 1], indices[i + 2]]);
  }
  return faces;
}

function getBevelVec(inPt, inPrev, inNext) {
  const EPSILON = 1e-10;

  const v_prev_x = inPt.x - inPrev.x;
  const v_prev_y = inPt.y - inPrev.y;
  const v_next_x = inNext.x - inPt.x;
  const v_next_y = inNext.y - inPt.y;

  const v_prev_lensq = v_prev_x * v_prev_x + v_prev_y * v_prev_y;
  const collinear0 = v_prev_x * v_next_y - v_prev_y * v_next_x;

  let v_trans_x, v_trans_y, shrink_by;

  if (Math.abs(collinear0) > EPSILON) {
    const v_prev_len = Math.sqrt(v_prev_lensq);
    const v_next_len = Math.sqrt(v_next_x * v_next_x + v_next_y * v_next_y);

    const ptPrevShift_x = inPrev.x - v_prev_y / v_prev_len;
    const ptPrevShift_y = inPrev.y + v_prev_x / v_prev_len;
    const ptNextShift_x = inNext.x - v_next_y / v_next_len;
    const ptNextShift_y = inNext.y + v_next_x / v_next_len;

    const sf = ((ptNextShift_x - ptPrevShift_x) * v_next_y -
      (ptNextShift_y - ptPrevShift_y) * v_next_x) /
      (v_prev_x * v_next_y - v_prev_y * v_next_x);

    v_trans_x = ptPrevShift_x + v_prev_x * sf - inPt.x;
    v_trans_y = ptPrevShift_y + v_prev_y * sf - inPt.y;

    const v_trans_lensq = v_trans_x * v_trans_x + v_trans_y * v_trans_y;
    if (v_trans_lensq <= 2) {
      return { x: v_trans_x, y: v_trans_y };
    } else {
      shrink_by = Math.sqrt(v_trans_lensq / 2);
    }
  } else {
    let direction_eq = false;
    if (v_prev_x > EPSILON) {
      if (v_next_x > EPSILON) direction_eq = true;
    } else if (v_prev_x < -EPSILON) {
      if (v_next_x < -EPSILON) direction_eq = true;
    } else {
      if (Math.sign(v_prev_y) === Math.sign(v_next_y)) direction_eq = true;
    }

    if (direction_eq) {
      v_trans_x = -v_prev_y;
      v_trans_y = v_prev_x;
      shrink_by = Math.sqrt(v_prev_lensq);
    } else {
      v_trans_x = v_prev_x;
      v_trans_y = v_prev_y;
      shrink_by = Math.sqrt(v_prev_lensq / 2);
    }
  }

  return { x: v_trans_x / shrink_by, y: v_trans_y / shrink_by };
}

function scalePt2(pt, vec, size) {
  return { x: pt.x + vec.x * size, y: pt.y + vec.y * size };
}

function mergeOverlappingPoints(points) {
  if (points.length === 0) return [];
  const THRESHOLD_SQ = 1e-20;
  const result = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const distSq = dx * dx + dy * dy;

    const scalingFactor = Math.max(Math.abs(curr.x), Math.abs(curr.y), Math.abs(prev.x), Math.abs(prev.y), 1);
    const thresholdSqScaled = THRESHOLD_SQ * scalingFactor * scalingFactor;

    if (distSq > thresholdSqScaled) {
      result.push(curr);
    }
  }

  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const distSq = dx * dx + dy * dy;
    const scalingFactor = Math.max(Math.abs(first.x), Math.abs(first.y), Math.abs(last.x), Math.abs(last.y), 1);
    const thresholdSqScaled = THRESHOLD_SQ * scalingFactor * scalingFactor;
    if (distSq <= thresholdSqScaled) {
      result.pop();
    }
  }

  return result;
}

function computeBounds(vertices) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

function boundsContain(outer, inner) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

// ============================================================================
// Main extrusion logic with separate cap/side handling for proper normals
// ============================================================================

/**
 * Create extruded text geometry with bevel
 */
function contoursToExtrudedModel(contours, options = {}) {
  const depth = options.depth !== undefined ? options.depth : 1;
  let bevelEnabled = options.bevelEnabled !== undefined ? options.bevelEnabled : true;
  let bevelThickness = options.bevelThickness !== undefined ? options.bevelThickness : depth * 0.1;
  // Negate bevelSize because our CCW contour convention produces inward-pointing bevel vectors
  let bevelSize = options.bevelSize !== undefined ? -options.bevelSize : -bevelThickness;
  let bevelSegments = options.bevelSegments !== undefined ? options.bevelSegments : 3;
  let bevelOffset = options.bevelOffset !== undefined ? -options.bevelOffset : 0;

  if (!bevelEnabled) {
    bevelSegments = 0;
    bevelThickness = 0;
    bevelSize = 0;
    bevelOffset = 0;
  }

  if (contours.length === 0) {
    let geom = new p5.Geometry();
    geom.gid = (Math.random() * 10000).toFixed(0)
    return geom
  }

  const shapes = groupContoursIntoShapes(contours);

  // We'll build geometry with unshared vertices for caps vs sides
  // This allows proper flat normals on caps and smooth normals on sides
  const finalVertices = [];
  const finalNormals = [];
  const finalFaces = [];

  for (const shape of shapes) {
    buildShapeGeometry(
      shape.outer, shape.holes,
      depth, bevelEnabled, bevelThickness, bevelSize, bevelSegments, bevelOffset,
      finalVertices, finalNormals, finalFaces
    );
  }

  // Create p5.Geometry
  const geom = new p5.Geometry();
  geom.gid = (Math.random() * 10000).toFixed(0)

  for (let i = 0; i < finalVertices.length; i++) {
    const v = finalVertices[i];
    geom.vertices.push(createVector(v.x, v.y, v.z));
    const n = finalNormals[i];
    geom.vertexNormals.push(createVector(n.x, n.y, n.z));
  }

  for (const face of finalFaces) {
    geom.faces.push(face.reverse());
  }

  return geom;
}

/**
 * Create extruded text geometry with bevel
 */
function textToExtrudedModel(font, text, x, y, options = {}) {
  const depth = options.depth !== undefined ? options.depth : 1;
  const sampleFactor = options.sampleFactor !== undefined ? options.sampleFactor : 1;
  let bevelEnabled = options.bevelEnabled !== undefined ? options.bevelEnabled : true;
  let bevelThickness = options.bevelThickness !== undefined ? options.bevelThickness : depth * 0.1;
  // Negate bevelSize because our CCW contour convention produces inward-pointing bevel vectors
  let bevelSize = options.bevelSize !== undefined ? -options.bevelSize : -bevelThickness;
  let bevelSegments = options.bevelSegments !== undefined ? options.bevelSegments : 3;
  let bevelOffset = options.bevelOffset !== undefined ? -options.bevelOffset : 0;

  if (!bevelEnabled) {
    bevelSegments = 0;
    bevelThickness = 0;
    bevelSize = 0;
    bevelOffset = 0;
  }

  const contours = font.textToContours(text, x, y, { sampleFactor });
  if (contours.length === 0) {
    let geom = new p5.Geometry();
    geom.gid = (Math.random() * 10000).toFixed(0)
    return geom
  }

  const shapes = groupContoursIntoShapes(contours);

  // We'll build geometry with unshared vertices for caps vs sides
  // This allows proper flat normals on caps and smooth normals on sides
  const finalVertices = [];
  const finalNormals = [];
  const finalFaces = [];

  for (const shape of shapes) {
    buildShapeGeometry(
      shape.outer, shape.holes,
      depth, bevelEnabled, bevelThickness, bevelSize, bevelSegments, bevelOffset,
      finalVertices, finalNormals, finalFaces
    );
  }

  // Create p5.Geometry
  const geom = new p5.Geometry();
  geom.gid = (Math.random() * 10000).toFixed(0)

  for (let i = 0; i < finalVertices.length; i++) {
    const v = finalVertices[i];
    geom.vertices.push(createVector(v.x, v.y, v.z));
    const n = finalNormals[i];
    geom.vertexNormals.push(createVector(n.x, n.y, n.z));
  }

  for (const face of finalFaces) {
    geom.faces.push(face);
  }

  return geom;
}

function groupContoursIntoShapes(contours) {
  const processed = contours.map(contour => {
    const vertices = contour.map(p => ({ x: p.x, y: p.y }));
    const cleaned = mergeOverlappingPoints(vertices);
    const cw = isClockwise(cleaned);
    const bounds = computeBounds(cleaned);
    return { vertices: cleaned, clockwise: cw, bounds };
  });

  const outers = [];
  const holes = [];

  for (const p of processed) {
    if (p.vertices.length < 3) continue;
    if (p.clockwise) {
      holes.push(p);
    } else {
      outers.push(p);
    }
  }

  const shapes = [];

  for (const outer of outers) {
    const shape = { outer: outer.vertices, holes: [] };
    for (const hole of holes) {
      if (boundsContain(outer.bounds, hole.bounds)) {
        shape.holes.push(hole.vertices.slice().reverse());
      }
    }
    shapes.push(shape);
  }

  if (shapes.length === 0 && holes.length > 0) {
    for (const hole of holes) {
      shapes.push({ outer: hole.vertices.slice().reverse(), holes: [] });
    }
  }

  return shapes;
}

function buildShapeGeometry(contour, holes, depth, bevelEnabled, bevelThickness, bevelSize, bevelSegments, bevelOffset, finalVertices, finalNormals, finalFaces) {
  // Ensure contour is counter-clockwise
  if (isClockwise(contour)) {
    contour = contour.slice().reverse();
  }

  // Ensure holes are clockwise
  holes = holes.map(hole => {
    if (!isClockwise(hole)) {
      return hole.slice().reverse();
    }
    return hole;
  });

  // Clean up contours
  contour = mergeOverlappingPoints(contour);
  holes = holes.map(h => mergeOverlappingPoints(h));

  if (contour.length < 3) return;

  // Calculate bevel movement vectors
  const contourMovements = [];
  for (let i = 0; i < contour.length; i++) {
    const prev = contour[(i - 1 + contour.length) % contour.length];
    const curr = contour[i];
    const next = contour[(i + 1) % contour.length];
    contourMovements.push(getBevelVec(curr, prev, next));
  }

  const holesMovements = holes.map(hole => {
    const movements = [];
    for (let i = 0; i < hole.length; i++) {
      const prev = hole[(i - 1 + hole.length) % hole.length];
      const curr = hole[i];
      const next = hole[(i + 1) % hole.length];
      movements.push(getBevelVec(curr, prev, next));
    }
    return movements;
  });

  // Build all 2D vertices and movements (contour + holes)
  let allVertices2D = [...contour];
  let allMovements = [...contourMovements];
  for (let h = 0; h < holes.length; h++) {
    allVertices2D = allVertices2D.concat(holes[h]);
    allMovements = allMovements.concat(holesMovements[h]);
  }

  const vlen = allVertices2D.length;
  const steps = 1;

  // Generate layer vertices
  // Structure: bevelSegments front layers + (steps+1) main layers + bevelSegments back layers
  const layers = [];

  // Front bevel layers
  for (let b = 0; b < bevelSegments; b++) {
    const t = b / bevelSegments;
    const z = -bevelThickness * Math.cos(t * Math.PI / 2);
    const bs = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;

    const layer = [];
    for (let i = 0; i < contour.length; i++) {
      const vert = scalePt2(contour[i], contourMovements[i], bs);
      layer.push({ x: vert.x, y: vert.y, z });
    }
    for (let h = 0; h < holes.length; h++) {
      const hole = holes[h];
      const movements = holesMovements[h];
      for (let i = 0; i < hole.length; i++) {
        const vert = scalePt2(hole[i], movements[i], bs);
        layer.push({ x: vert.x, y: vert.y, z });
      }
    }
    layers.push(layer);
  }

  const bs = bevelSize + bevelOffset;

  // Main extrusion layers (z = 0 to depth)
  for (let s = 0; s <= steps; s++) {
    const z = depth * s / steps;
    const layer = [];
    for (let i = 0; i < allVertices2D.length; i++) {
      const vert = bevelEnabled ? scalePt2(allVertices2D[i], allMovements[i], bs) : allVertices2D[i];
      layer.push({ x: vert.x, y: vert.y, z });
    }
    layers.push(layer);
  }

  // Back bevel layers
  for (let b = bevelSegments - 1; b >= 0; b--) {
    const t = b / bevelSegments;
    const z = depth + bevelThickness * Math.cos(t * Math.PI / 2);
    const bs2 = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;

    const layer = [];
    for (let i = 0; i < contour.length; i++) {
      const vert = scalePt2(contour[i], contourMovements[i], bs2);
      layer.push({ x: vert.x, y: vert.y, z });
    }
    for (let h = 0; h < holes.length; h++) {
      const hole = holes[h];
      const movements = holesMovements[h];
      for (let i = 0; i < hole.length; i++) {
        const vert = scalePt2(hole[i], movements[i], bs2);
        layer.push({ x: vert.x, y: vert.y, z });
      }
    }
    layers.push(layer);
  }

  // Triangulate for caps
  let triangulationContour, triangulationHoles;
  if (bevelEnabled && bevelSegments > 0) {
    const bs3 = bevelOffset; // innermost bevel (t=0)
    triangulationContour = contour.map((v, i) => scalePt2(v, contourMovements[i], bs3));
    triangulationHoles = holes.map((hole, h) =>
      hole.map((v, i) => scalePt2(v, holesMovements[h][i], bs3))
    );
  } else {
    triangulationContour = contour;
    triangulationHoles = holes;
  }

  const shapeFaces = triangulateShape(triangulationContour, triangulationHoles);

  // ========================================
  // Build front cap with flat normals
  // ========================================
  const frontLayer = layers[0];
  const frontNormal = { x: 0, y: 0, z: -1 };
  const frontVertexOffset = finalVertices.length;

  for (let i = 0; i < vlen; i++) {
    finalVertices.push({ x: frontLayer[i].x, y: frontLayer[i].y, z: frontLayer[i].z });
    finalNormals.push({ x: frontNormal.x, y: frontNormal.y, z: frontNormal.z });
  }

  for (const face of shapeFaces) {
    // Reverse winding for front face
    finalFaces.push([
      face[2] + frontVertexOffset,
      face[1] + frontVertexOffset,
      face[0] + frontVertexOffset
    ]);
  }

  // ========================================
  // Build back cap with flat normals
  // ========================================
  const backLayer = layers[layers.length - 1];
  const backNormal = { x: 0, y: 0, z: 1 };
  const backVertexOffset = finalVertices.length;

  for (let i = 0; i < vlen; i++) {
    finalVertices.push({ x: backLayer[i].x, y: backLayer[i].y, z: backLayer[i].z });
    finalNormals.push({ x: backNormal.x, y: backNormal.y, z: backNormal.z });
  }

  for (const face of shapeFaces) {
    finalFaces.push([
      face[0] + backVertexOffset,
      face[1] + backVertexOffset,
      face[2] + backVertexOffset
    ]);
  }

  // ========================================
  // Build side walls with smooth normals
  // ========================================
  // For each vertex on the contour edge, we need smooth normals across all layers
  // We'll duplicate vertices for each layer but share normals at each position

  const numLayers = layers.length;

  // For smooth normals, we average adjacent face normals
  // Pre-compute edge normals for each contour segment at each layer

  // Build sides for contour
  buildSideWallsSmooth(contour.length, 0, layers, finalVertices, finalNormals, finalFaces);

  // Build sides for each hole
  let offset = contour.length;
  for (const hole of holes) {
    buildSideWallsSmooth(hole.length, offset, layers, finalVertices, finalNormals, finalFaces);
    offset += hole.length;
  }
}

function buildSideWallsSmooth(contourLength, offset, layers, finalVertices, finalNormals, finalFaces) {
  const numLayers = layers.length;

  // Create a grid of vertices for this contour ring
  // Each vertex at (i, layerIdx) gets its position from layers[layerIdx][offset + i]

  // Compute smooth normals by averaging the normals of adjacent quads
  // For vertex at (i, layerIdx), the normal is influenced by:
  // - quad (i-1, layerIdx-1) to (i, layerIdx)
  // - quad (i, layerIdx-1) to (i+1, layerIdx)
  // - quad (i-1, layerIdx) to (i, layerIdx+1)
  // - quad (i, layerIdx) to (i+1, layerIdx+1)

  // First, compute face normals for all quads
  const quadNormals = [];
  for (let s = 0; s < numLayers - 1; s++) {
    const layerNormals = [];
    for (let i = 0; i < contourLength; i++) {
      const j = i;
      const k = (i + 1) % contourLength;

      const a = layers[s][offset + j];
      const b = layers[s][offset + k];
      const c = layers[s + 1][offset + k];
      const d = layers[s + 1][offset + j];

      // Compute quad normal (average of two triangle normals)
      const n1 = computeTriangleNormal(a, b, d);
      const n2 = computeTriangleNormal(b, c, d);
      const nx = (n1.x + n2.x) / 2;
      const ny = (n1.y + n2.y) / 2;
      const nz = (n1.z + n2.z) / 2;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      layerNormals.push(len > 0 ? { x: nx / len, y: ny / len, z: nz / len } : { x: 0, y: 0, z: 1 });
    }
    quadNormals.push(layerNormals);
  }

  // Now create vertices with smoothed normals
  // For each vertex (i, layerIdx), average normals from surrounding quads
  const vertexGrid = [];
  for (let s = 0; s < numLayers; s++) {
    const layerVertices = [];
    for (let i = 0; i < contourLength; i++) {
      const pos = layers[s][offset + i];

      // Collect normals from adjacent quads
      const adjacentNormals = [];

      // Quad at (i-1, s-1) - top-left
      if (s > 0) {
        const prevI = (i - 1 + contourLength) % contourLength;
        adjacentNormals.push(quadNormals[s - 1][prevI]);
      }
      // Quad at (i, s-1) - top-right
      if (s > 0) {
        adjacentNormals.push(quadNormals[s - 1][i]);
      }
      // Quad at (i-1, s) - bottom-left
      if (s < numLayers - 1) {
        const prevI = (i - 1 + contourLength) % contourLength;
        adjacentNormals.push(quadNormals[s][prevI]);
      }
      // Quad at (i, s) - bottom-right
      if (s < numLayers - 1) {
        adjacentNormals.push(quadNormals[s][i]);
      }

      // Average normals
      let nx = 0, ny = 0, nz = 0;
      for (const n of adjacentNormals) {
        nx += n.x;
        ny += n.y;
        nz += n.z;
      }
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const normal = len > 0 ? { x: nx / len, y: ny / len, z: nz / len } : { x: 0, y: 0, z: 1 };

      layerVertices.push({ pos, normal });
    }
    vertexGrid.push(layerVertices);
  }

  // Add vertices to final arrays and build faces
  const baseIdx = finalVertices.length;

  for (let s = 0; s < numLayers; s++) {
    for (let i = 0; i < contourLength; i++) {
      const { pos, normal } = vertexGrid[s][i];
      finalVertices.push({ x: pos.x, y: pos.y, z: pos.z });
      finalNormals.push({ x: normal.x, y: normal.y, z: normal.z });
    }
  }

  // Build faces
  for (let s = 0; s < numLayers - 1; s++) {
    for (let i = 0; i < contourLength; i++) {
      const j = i;
      const k = (i + 1) % contourLength;

      const a = baseIdx + s * contourLength + j;
      const b = baseIdx + s * contourLength + k;
      const c = baseIdx + (s + 1) * contourLength + k;
      const d = baseIdx + (s + 1) * contourLength + j;

      finalFaces.push([a, b, d]);
      finalFaces.push([b, c, d]);
    }
  }
}

function computeTriangleNormal(v0, v1, v2) {
  const ax = v1.x - v0.x, ay = v1.y - v0.y, az = v1.z - v0.z;
  const bx = v2.x - v0.x, by = v2.y - v0.y, bz = v2.z - v0.z;

  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len > 0) {
    nx /= len;
    ny /= len;
    nz /= len;
  }

  return { x: nx, y: ny, z: nz };
}

function extrudePathLoops(cmds, { dist = 10, bevel = 5 } = {}) {
  const paths = splitPaths(cmds)
  const contours = []
  for (let j = 0; j < paths.length; j++) {
    const pts = pathToPoints(paths[j], options);
    // console.log(paths[j])
    contours.push(pts.map(({ x, y }) => createVector(x, y, 0)));
  }

  return contoursToExtrudedModel(contours, {
    depth: dist,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
  })
}

function extrudeContours(contours, { dist = 10, bevel = 5 } = {}) {
  return contoursToExtrudedModel(contours, {
    depth: dist,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
  })
}