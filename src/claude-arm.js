// 坐标以原立绘的 1024 × 1536 画布为准，书与前臂共用肘部转轴。
const claudeArmFragment = `
  precision highp float;
  varying vec2 uv;
  uniform sampler2D portraitImage;
  uniform float angle;

  float insideEdge(vec2 p, vec2 start, vec2 end) {
    vec2 edge = normalize(end - start);
    return dot(p - start, vec2(-edge.y, edge.x));
  }

  void main() {
    vec2 size = vec2(1024., 1536.);
    vec2 p = uv * size;
    if (p.x > 211. && p.x < 483. && p.y > 241. && p.y < 615.) {
      vec2 a = vec2(253., 331.);
      vec2 b = vec2(361., 284.);
      vec2 c = vec2(443., 494.);
      vec2 d = vec2(305., 536.);
      float book = min(min(insideEdge(p, a, b), insideEdge(p, b, c)),
                       min(insideEdge(p, c, d), insideEdge(p, d, a)));
      float sleeve = length((p - vec2(321., 504.)) / vec2(59., 94.));
      // 书和手掌保持形状；袖口的动作逐渐过渡到静止的上臂与周围衣料。
      float weight = max(smoothstep(-34., 0., book),
                         1. - smoothstep(.65, 1.16, sleeve));
      vec2 elbow = vec2(367., 574.);
      vec2 offset = p - elbow;
      float theta = angle * weight;
      float sine = sin(theta);
      float cosine = cos(theta);
      p = elbow + vec2(cosine * offset.x - sine * offset.y,
                       sine * offset.x + cosine * offset.y);
    }
    gl_FragColor = texture2D(portraitImage, p / size);
  }
`;

function createArmPainter(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, depth: false });
  if (!gl) return null;

  function compile(kind, code) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  const vertex = compile(gl.VERTEX_SHADER, `
    attribute vec2 point;
    varying vec2 uv;
    void main() {
      uv = point;
      gl_Position = vec4(point.x * 2. - 1., 1. - point.y * 2., 0., 1.);
    }
  `);
  const fragment = compile(gl.FRAGMENT_SHADER, claudeArmFragment);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const point = gl.getAttribLocation(program, 'point');
  gl.enableVertexAttribArray(point);
  gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const angleUniform = gl.getUniformLocation(program, 'angle');

  return {
    load(source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },
    draw(angle) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(angleUniform, angle);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
}

function setupClaudeArm(canvas, flat) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame, painter, uploaded;
  let unavailable = false;
  let raf = 0;
  let startedAt, lastAngle;
  let pixelWidth, pixelHeight;

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    startedAt = lastAngle = undefined;
    canvas.hidden = true;
    if (frame) flat.hidden = false;
  }

  function draw(time) {
    startedAt ??= time;
    // 匀滑地抬起、回落，在原位稍停。时间以显示器刷新帧为准。
    const progress = Math.min(1, ((time - startedAt) % 6500) / 5400);
    const angle = (1 - Math.cos(progress * 2 * Math.PI)) * Math.PI / 150;
    if (lastAngle !== angle || canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      painter.draw(angle);
      lastAngle = angle;
    }
    raf = requestAnimationFrame(draw);
  }

  function sync() {
    if (!frame || unavailable || document.hidden || reduced.matches ||
      document.documentElement.dataset.motion === 'reduce') {
      stop();
      return;
    }
    if (raf) return;
    try {
      painter ??= createArmPainter(canvas);
      if (!painter) { unavailable = true; return; }
      if (uploaded !== frame) {
        painter.load(frame);
        uploaded = frame;
      }
      canvas.hidden = false;
      resize();
      draw(performance.now());
      flat.hidden = true;
    } catch (error) {
      console.warn('Claude arm animation unavailable:', error);
      unavailable = true;
      stop();
    }
  }

  function resize() {
    if (!frame || canvas.hidden) return;
    pixelWidth = Math.max(1, Math.min(frame.width, Math.round(canvas.offsetWidth * devicePixelRatio)));
    pixelHeight = Math.round(pixelWidth * frame.height / frame.width);
  }

  new ResizeObserver(resize).observe(canvas.parentElement);
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  canvas.addEventListener('webglcontextlost', () => {
    unavailable = true;
    stop();
  });

  return {
    show(source) { frame = source; sync(); },
    clear() { stop(); frame = undefined; }
  };
}
