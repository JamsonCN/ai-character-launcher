const portraitFrames = new Map();
const portraitHeight = 1800;
const groundShadowStart = {
  'chatgpt-v2.png': .943,
  'claude-v2.png': .956,
  'deepseek-v2.png': .954,
  'kimi-v2.png': .934,
  'glm-v2.png': .934
};
// 取样点位于发丝、衣摆与尾巴围出的背景内，坐标对应新版原图。
const backdropSeeds = {
  'chatgpt-v2.png': [
    [628, 172], [650, 198], [646, 221], [656, 254], [670, 279], [661, 309],
    [690, 320], [687, 342], [688, 413], [221, 457], [271, 450], [241, 481],
    [296, 473], [201, 564], [170, 574], [194, 589], [182, 615], [650, 990],
    [730, 1111]
  ],
  'claude-v2.png': [
    [422, 80], [397, 119], [380, 163], [392, 189], [404, 225], [392, 260],
    [403, 285], [795, 434], [815, 488], [777, 477], [867, 548], [801, 546],
    [206, 595], [839, 604], [184, 611], [100, 625], [178, 636], [88, 670],
    [897, 672], [152, 667], [863, 653], [915, 736], [163, 696], [148, 714],
    [222, 739], [226, 711], [794, 719], [788, 752], [194, 769], [756, 771],
    [825, 824], [83, 811], [183, 810], [835, 776], [895, 827], [215, 826],
    [790, 822], [232, 873], [751, 880], [250, 893], [794, 895], [127, 916],
    [409, 60], [197, 545]
  ],
  'deepseek-v2.png': [
    [276, 418], [309, 417], [95, 438], [148, 462], [202, 470], [268, 479],
    [132, 506], [201, 527], [142, 540], [166, 540], [87, 549], [345, 549],
    [268, 560], [149, 559], [221, 586], [107, 597], [274, 601], [713, 619],
    [134, 640], [82, 776], [120, 831]
  ],
  'kimi-v2.png': [
    [315, 369], [719, 359], [796, 388], [348, 408], [300, 408], [284, 442],
    [868, 476], [801, 472], [888, 486], [790, 491], [247, 503], [234, 490],
    [209, 524], [181, 544], [901, 550], [838, 533], [890, 554], [239, 543],
    [229, 549], [832, 562], [243, 565], [186, 589], [831, 588], [127, 606],
    [209, 615], [903, 615], [871, 617], [123, 640], [265, 630], [941, 625],
    [157, 646], [912, 652], [871, 666], [128, 667], [910, 680], [922, 678],
    [872, 682], [174, 691], [956, 725], [200, 705], [113, 730], [179, 761],
    [928, 773], [194, 798], [848, 827], [557, 1324], [380, 235], [355, 346],
    [321, 421], [774, 403], [693, 305], [134, 631], [142, 714], [872, 712]
  ],
  'glm-v2.png': [
    [413, 165], [394, 208], [410, 204], [406, 222], [718, 360], [357, 367],
    [720, 421], [347, 417], [343, 452], [769, 464], [798, 496], [310, 500],
    [753, 503], [257, 545], [774, 514], [782, 539], [214, 585], [790, 561],
    [825, 589], [254, 588], [820, 599], [795, 620], [226, 634], [185, 655],
    [813, 647], [829, 641], [874, 661], [859, 694], [214, 667], [835, 678],
    [250, 732], [899, 720], [188, 695], [747, 699], [183, 710], [794, 720],
    [173, 737], [194, 757], [825, 756], [243, 780], [213, 799], [243, 832],
    [300, 419], [413, 221]
  ]
};
const LIGHT = 1;
const SHADOW = 2;
const UNSEEN = 0;
const VISITED = 1;
const BACKDROP = 2;

function getPortraitFrame(file) {
  if (!portraitFrames.has(file)) {
    const source = new Image();
    source.src = `assets/${file}`;
    const frame = source.decode()
      .then(() => compositePortrait(source, file))
      .catch((error) => {
        portraitFrames.delete(file);
        throw error;
      });
    portraitFrames.set(file, frame);
  }
  return portraitFrames.get(file);
}

function compositePortrait(source, file) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, portraitHeight / source.naturalHeight);
  const width = canvas.width = Math.round(source.naturalWidth * scale);
  const height = canvas.height = Math.round(source.naturalHeight * scale);
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0, width, height);

  const frame = context.getImageData(0, 0, width, height);
  const pixels = frame.data;
  const size = width * height;
  const candidates = new Uint8Array(size);
  const regions = new Uint8Array(size);
  const queue = new Int32Array(size);
  const shadowRow = Math.floor(height * (groundShadowStart[file] ?? 1)) * width;
  const dragon = file === 'chatgpt-v2.png';
  const shadowMin = dragon ? 52 : 125;
  const shadowChroma = dragon ? 75 : 60;
  const seeds = new Set((backdropSeeds[file] ?? []).map(([x, y]) =>
    Math.round(y * scale) * width + Math.round(x * scale)
  ));

  // 只对近中性的浅色区域判定背景。连通区域能保住有轮廓包围的浅色衣料。
  for (let index = 0; index < size; index += 1) {
    const offset = index * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const low = Math.min(red, green, blue);
    const high = Math.max(red, green, blue);
    if (low >= 232 && high - low <= 11) {
      candidates[index] = LIGHT;
    } else if (index >= shadowRow && low >= shadowMin && high - low <= shadowChroma) {
      candidates[index] = SHADOW;
    }
  }

  // 地面投影的色彩连续变化，鞋跟和衣摆轮廓通常有更强的明暗跳变。
  function isSmoothEdge(index, from) {
    const a = index * 4;
    const b = from * 4;
    return Math.max(
      Math.abs(pixels[a] - pixels[b]),
      Math.abs(pixels[a + 1] - pixels[b + 1]),
      Math.abs(pixels[a + 2] - pixels[b + 2])
    ) <= 10;
  }

  function addNeighbor(index, from) {
    if (!candidates[index] || regions[index] !== UNSEEN) return;
    if (from !== undefined && (candidates[index] === SHADOW || candidates[from] === SHADOW) &&
      !isSmoothEdge(index, from)) return;
    regions[index] = VISITED;
    queue[length] = index;
    length += 1;
  }

  let length;
  for (let start = 0; start < size; start += 1) {
    if (!candidates[start] || regions[start] !== UNSEEN) continue;
    length = 0;
    let touchesEdge = false;
    let containsBackdropSeed = false;
    addNeighbor(start);
    for (let head = 0; head < length; head += 1) {
      const index = queue[head];
      const x = index % width;
      if (x === 0 || x === width - 1 || index < width || index >= size - width) {
        touchesEdge = true;
      }
      if (seeds.has(index)) containsBackdropSeed = true;
      if (x > 0) addNeighbor(index - 1, index);
      if (x < width - 1) addNeighbor(index + 1, index);
      if (index >= width) addNeighbor(index - width, index);
      if (index < size - width) addNeighbor(index + width, index);
    }

    // 发丝、翼膜和衣摆围出的空隙也会露出舞台。
    const isBackdrop = touchesEdge || containsBackdropSeed;
    if (isBackdrop) {
      for (let index = 0; index < length; index += 1) {
        regions[queue[index]] = BACKDROP;
        pixels[queue[index] * 4 + 3] = 0;
      }
    }
  }

  // 清理与背景相邻的浅色抗锯齿边缘。图案内部和深色线稿保持原色。
  for (let index = 0; index < size; index += 1) {
    if (regions[index] === BACKDROP) continue;
    const x = index % width;
    const bordersBackdrop = (x > 0 && regions[index - 1] === BACKDROP) ||
      (x < width - 1 && regions[index + 1] === BACKDROP) ||
      regions[index - width] === BACKDROP || regions[index + width] === BACKDROP;
    if (!bordersBackdrop) continue;

    const offset = index * 4;
    const low = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    const high = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    if (low <= 166 || high - low >= 32) continue;
    const alpha = Math.max(.18, 1 - (low - 166) / 90);
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[offset + channel] = (pixels[offset + channel] - 250 * (1 - alpha)) / alpha;
    }
    pixels[offset + 3] = Math.round(255 * alpha);
  }
  context.putImageData(frame, 0, 0);
  return canvas;
}
