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

let easings;
let easingSelect;

function applyEasing(t) {
  let fn = easings && easingSelect ? easings[easingSelect.value] : null;
  return typeof fn === "function" ? fn(t) : t;
}