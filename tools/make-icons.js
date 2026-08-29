/**
 * アイコン生成スクリプト (依存なし)。
 *   node tools/make-icons.js
 *
 * 角丸の背景 (青 -> 水色) に白い枠を回し、その中に単眼鏡を描く。
 * 地の色を持たない黒いグリフだと、ツールバーの配色によっては沈んで
 * 見えなくなるため、背景と枠を必ず持たせている。
 *
 * 図形は符号付き距離で表し、そこから被覆率 (0..1) を作る。4 倍の
 * スーパーサンプリングと合わせて、16px でも縁が滑らかになる。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 4; // スーパーサンプリング

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 符号付き距離 (負が内側) を被覆率にする。 */
function coverage(distance) {
  return clamp01(0.5 - distance);
}

function sdRoundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdCircle(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) - radius;
}

/** 太さのある円 (リング)。 */
function sdRing(px, py, cx, cy, radius, thickness) {
  return Math.abs(sdCircle(px, py, cx, cy, radius)) - thickness / 2;
}

/** 太さのある線分 (両端は丸い)。 */
function sdSegment(px, py, ax, ay, bx, by, thickness) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp01((wx * vx + wy * vy) / len2);
  return Math.hypot(wx - vx * t, wy - vy * t) - thickness / 2;
}

/** 2 次ベジェ。折れ線に割って最短距離を取る。 */
function sdCurve(px, py, p0, p1, p2, thickness) {
  let best = Infinity;
  let prevX = p0[0];
  let prevY = p0[1];
  const STEPS = 24;
  for (let i = 1; i <= STEPS; i += 1) {
    const t = i / STEPS;
    const u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    best = Math.min(best, sdSegment(px, py, prevX, prevY, x, y, thickness));
    prevX = x;
    prevY = y;
  }
  return best;
}

/** 背景の斜めグラデーション (左上の青 -> 右下の水色)。 */
function background(u, v) {
  const t = clamp01(u * 0.5 + v * 0.5);
  return [37 + (6 - 37) * t, 99 + (182 - 99) * t, 235 + (212 - 235) * t];
}

function renderIcon(size) {
  const W = size * SS;
  const rgba = new Float64Array(W * W * 4); // 乗算前 RGB と アルファ

  /** 図形を 1 枚重ねる。cover は 0..1。 */
  function paint(i, r, g, b, cover) {
    if (cover <= 0) return;
    const a = rgba[i + 3];
    const na = cover + a * (1 - cover);
    if (na <= 0) return;
    rgba[i] = (r * cover + rgba[i] * a * (1 - cover)) / na;
    rgba[i + 1] = (g * cover + rgba[i + 1] * a * (1 - cover)) / na;
    rgba[i + 2] = (b * cover + rgba[i + 2] * a * (1 - cover)) / na;
    rgba[i + 3] = na;
  }

  // 各部の寸法は W に対する割合で持つ。どの大きさでも同じ形になる。
  //
  // ただし 16px では線が 1px を割ってしまうため、白い内枠は描かず、
  // 単眼鏡を一回り大きくする。小さいうちは輪郭の暗い縁が枠の役をする。
  const small = size <= 20;

  const bgRadius = 0.22 * W;
  const edgeWidth = 0.055 * W; // 明るい背景でも形が分かるよう、外周を少し暗くする
  const frameInset = 0.072 * W;
  const frameWidth = small ? 0 : 0.038 * W;

  const scale = small ? 1.14 : 1;
  const lensX = 0.43 * W;
  const lensY = 0.41 * W;
  const lensR = 0.205 * scale * W;
  const lensT = 0.078 * scale * W;

  // 鎖を吊る耳。虫眼鏡の柄と違って、レンズの横から細い鎖が垂れる。
  const lugX = lensX + 0.215 * scale * W;
  const lugY = lensY + 0.10 * scale * W;
  const lugR = 0.055 * scale * W;

  const chainFrom = [lugX, lugY];
  const chainVia = [0.83 * W, 0.61 * W];
  const chainTo = [0.795 * W, 0.85 * W];
  const chainT = (small ? 0.058 : 0.038) * W;
  const beadR = 0.055 * scale * W;

  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const i = (y * W + x) * 4;

      // 1. 地の色
      const bgCover = coverage(sdRoundedRect(px, py, W / 2, W / 2, W / 2, W / 2, bgRadius));
      if (bgCover <= 0) continue;
      const [br, bg, bb] = background(px / W, py / W);
      paint(i, br, bg, bb, bgCover);

      // 2. 外周の暗い縁。白い地の上でも角丸の形が消えないようにする。
      const edge = coverage(
        Math.abs(sdRoundedRect(px, py, W / 2, W / 2, W / 2, W / 2, bgRadius)) - edgeWidth / 2
      );
      paint(i, 0, 0, 0, Math.min(edge, bgCover) * 0.2);

      // 3. 白い内枠 (角丸の輪郭)。地の色の内側だけに出す。
      if (frameWidth > 0) {
        const frameHalf = W / 2 - frameInset;
        const frameDist = Math.abs(
          sdRoundedRect(px, py, W / 2, W / 2, frameHalf, frameHalf, bgRadius - frameInset)
        ) - frameWidth / 2;
        paint(i, 255, 255, 255, Math.min(coverage(frameDist), bgCover) * 0.88);
      }

      // 4. レンズのガラス (うっすら白い面)
      paint(i, 255, 255, 255, coverage(sdCircle(px, py, lensX, lensY, lensR - lensT / 2)) * 0.22);

      // 5. レンズの縁
      const lens = coverage(sdRing(px, py, lensX, lensY, lensR, lensT));

      // 6. 耳・鎖・その先の玉。細く垂れる鎖が、虫眼鏡の太い柄との違いになる。
      const lug = coverage(sdCircle(px, py, lugX, lugY, lugR));
      const chain = coverage(sdCurve(px, py, chainFrom, chainVia, chainTo, chainT));
      const bead = coverage(sdCircle(px, py, chainTo[0], chainTo[1], beadR));

      paint(i, 255, 255, 255, Math.max(Math.max(lens, lug), Math.max(chain, bead)));
    }
  }

  // ダウンサンプル
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          const pa = rgba[i + 3];
          r += rgba[i] * pa;
          g += rgba[i + 1] * pa;
          b += rgba[i + 2] * pa;
          a += pa;
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const srgb = (v) => Math.max(0, Math.min(255, Math.round(v)));
      out[o] = srgb(a > 0 ? r / a : 0);
      out[o + 1] = srgb(a > 0 ? g / a : 0);
      out[o + 2] = srgb(a > 0 ? b / a : 0);
      out[o + 3] = srgb((a / n) * 255);
    }
  }
  return out;
}

/* ---- PNG の書き出し --------------------------------------------------- */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba, size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'src', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 96]) {
  const file = path.join(outDir, 'icon-' + size + '.png');
  fs.writeFileSync(file, toPng(renderIcon(size), size));
  console.log('wrote ' + path.relative(path.join(__dirname, '..'), file));
}
