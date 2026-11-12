const originalOrder = ['chatgpt', 'claude', 'deepseek', 'kimi', 'glm'];
const stageWidth = 1672;
const stageHeight = 941;
const topEdges = [0, 450, 767, 1070, 1414, stageWidth];
const bottomEdges = [0, 283, 609, 922, 1257, stageWidth];

function loadArtwork(url) {
  const image = new Image();
  if (url.startsWith('launcher-image:')) image.crossOrigin = 'anonymous';
  image.src = url;
  return image.decode().then(() => image);
}

function canvasOfSize(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function customPanel(image, accent, width) {
  const canvas = canvasOfSize(width, stageHeight);
  const ctx = canvas.getContext('2d');
  const light = ctx.createRadialGradient(width * .5, stageHeight * .22, 0, width * .5, stageHeight * .22, stageHeight * .75);
  light.addColorStop(0, accent);
  light.addColorStop(1, '#100d18');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, stageHeight);
  const scale = Math.max(width / image.width, stageHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (stageHeight - drawHeight) * .16, drawWidth, drawHeight);
  return canvas;
}

async function galleryArtwork(roles) {
  if (roles.every((role, index) => role.id === originalOrder[index] && !role.imageUrl)) return '';
  const original = await loadArtwork('assets/stage.png');
  const sources = await Promise.all(roles.map(async (role, index) => {
    if (!role.imageUrl) return null;
    const width = Math.max(topEdges[index + 1] - topEdges[index], bottomEdges[index + 1] - bottomEdges[index]);
    try { return customPanel(await loadArtwork(role.imageUrl), role.accent, width); } catch { return null; }
  }));
  const canvas = canvasOfSize(stageWidth, stageHeight);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#120d1a';
  ctx.fillRect(0, 0, stageWidth, stageHeight);
  for (let y = 0; y < stageHeight; y += 1) {
    const edges = topEdges.map((edge, index) => Math.round(edge + (bottomEdges[index] - edge) * y / stageHeight));
    for (const [index, role] of roles.entries()) {
      const sourceIndex = originalOrder.indexOf(role.id);
      const panel = sources[index];
      const start = edges[index];
      const width = edges[index + 1] - start;
      if (panel) {
        const inset = index === 0 ? 0 : 3;
        ctx.drawImage(panel, 0, y, panel.width, 1, start + inset, y, width - inset - 3, 1);
      } else {
        ctx.drawImage(original, edges[sourceIndex], y, edges[sourceIndex + 1] - edges[sourceIndex], 1,
          start, y, width, 1);
      }
    }
  }
  return canvas.toDataURL('image/webp', .94);
}
