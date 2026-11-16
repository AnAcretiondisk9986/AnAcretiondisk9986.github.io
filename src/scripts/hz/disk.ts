/**
 * HORIZON · disk.ts
 * 实时 WebGL 史瓦西黑洞光线追踪（引力透镜 + 多普勒增亮吸积盘 + 后台底图弯曲天球）。
 * - 自适应分辨率 + 离屏/隐藏自动暂停 + prefers-reduced-motion 单帧渲染
 * - 支持 VOID（暗）与 PLATE（照相底片）平滑切换
 * - 支持 jsDelivr 多镜像加载 sky 纹理，失败时保留纯程序星空
 */

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'fastly.jsdelivr.net',
  'gcore.jsdelivr.net',
  'testingcf.jsdelivr.net',
];

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

varying vec2 v_uv;

uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_scroll;
uniform float u_plate;
uniform float u_hasTex;
uniform float u_texFade;
uniform sampler2D u_sky;

#define STEPS 78
#define RS 1.0

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return v;
}

vec3 blackbody(float t) {
  // 0..1: 深红 -> 等离子橙 -> 炽白金
  vec3 c0 = vec3(0.48, 0.09, 0.04);
  vec3 c1 = vec3(1.00, 0.35, 0.10);
  vec3 c2 = vec3(1.00, 0.78, 0.48);
  vec3 c3 = vec3(1.00, 0.96, 0.88);
  if (t < 0.35) return mix(c0, c1, t / 0.35);
  if (t < 0.72) return mix(c1, c2, (t - 0.35) / 0.37);
  return mix(c2, c3, (t - 0.72) / 0.28);
}

vec3 sampleSky(vec3 dir) {
  // 程序星场
  vec2 sph = vec2(atan(dir.z, dir.x) * 0.15915 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31831 + 0.5);
  vec2 g1 = sph * vec2(140.0, 70.0);
  vec2 id = floor(g1);
  vec2 fv = fract(g1) - 0.5;
  float h = hash21(id);
  float star = smoothstep(0.985, 0.999, h) * smoothstep(0.45, 0.05, length(fv));
  vec3 stars = mix(vec3(0.95, 0.88, 0.80), vec3(0.56, 0.70, 1.0), hash21(id + 7.1)) * star * 1.4;

  // 如果后台首屏图加载就绪，把被引力偏折后的天球映射到该图
  if (u_hasTex > 0.5 && u_texFade > 0.01) {
    vec2 uv = dir.xy * vec2(0.46, -0.46) + 0.5;
    uv = clamp(uv, 0.0, 1.0);
    vec3 img = texture2D(u_sky, uv).rgb;
    float edgeMask = smoothstep(0.0, 0.16, uv.x) * smoothstep(1.0, 0.84, uv.x)
                   * smoothstep(0.0, 0.16, uv.y) * smoothstep(1.0, 0.84, uv.y);
    stars += img * (0.28 * edgeMask * u_texFade);
  }
  return stars;
}

void main() {
  vec2 aspect = vec2(u_res.x / max(u_res.y, 1.0), 1.0);
  // 宽屏把黑洞略微偏右，给左侧文字让出暗区
  float shiftX = mix(0.0, 0.18, smoothstep(1.05, 1.5, aspect.x));
  vec2 p = (v_uv - 0.5) * 2.0 * aspect - vec2(shiftX * aspect.x, 0.0);

  // 相机轨道参数（随滚动向视界下潜）
  float camDist = mix(11.4, 6.6, clamp(u_scroll, 0.0, 1.0));
  float yaw = u_mouse.x * 0.24 + u_time * 0.035;
  float pitch = 0.22 - u_mouse.y * 0.16 + u_scroll * 0.08;

  vec3 ro = vec3(
    camDist * cos(pitch) * sin(yaw),
    camDist * sin(pitch),
    camDist * cos(pitch) * cos(yaw)
  );
  vec3 target = vec3(0.0, 0.0, 0.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * 1.65 + right * p.x + up * p.y);

  // 角动量平方 h^2 用于广义相对论有效势偏折项 -1.5 * h^2 / r^5
  vec3 hVec = cross(ro, rd);
  float h2 = dot(hVec, hVec);

  vec3 pos = ro;
  vec3 vel = rd;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float minR = 1e6;
  bool captured = false;

  float diskIn = 2.15;
  float diskOut = 7.4;

  for (int i = 0; i < STEPS; i++) {
    float r = length(pos);
    minR = min(minR, r);
    if (r < RS) {
      captured = true;
      break;
    }
    if (r > 18.0 && dot(pos, vel) > 0.0) {
      break;
    }

    float dt = clamp(0.06 * r, 0.045, 0.68);
    // 接近赤道面时缩步以精确命中吸积盘，同时保证光线能走完远端外缘
    if (abs(pos.y) < 0.45 && r < diskOut + 0.35) {
      dt = min(dt, 0.20);
    }

    vec3 prevPos = pos;
    float r5 = pow(max(r, 0.5), 5.0);
    vec3 acc = -1.5 * h2 * pos / r5;
    vel = normalize(vel + acc * dt);
    pos += vel * dt;

    // 检查是否穿过赤道吸积盘平面 y = 0
    if (prevPos.y * pos.y <= 0.0) {
      float frac = abs(prevPos.y) / max(abs(prevPos.y - pos.y), 1e-5);
      vec3 hit = mix(prevPos, pos, frac);
      float hr = length(hit.xz);
      if (hr > diskIn && hr < diskOut) {
        float ang = atan(hit.z, hit.x);
        float kepler = u_time * (2.6 / pow(hr, 1.15));
        float spiral = ang + kepler + 5.2 / sqrt(hr);

        float rings = fbm(vec2(hr * 2.1, spiral * 0.45));
        float fine = noise2(vec2(hr * 6.5, spiral * 1.4));
        float radialFade = smoothstep(diskIn, diskIn + 0.35, hr) * smoothstep(diskOut, diskIn + 1.1, hr);
        float density = radialFade * (0.35 + 0.75 * rings) * (0.65 + 0.35 * fine);

        // 相对论多普勒聚束：顺行侧增亮、逆行侧变暗
        vec3 tang = normalize(vec3(-hit.z, 0.0, hit.x));
        float vOrb = clamp(0.62 / sqrt(hr), 0.0, 0.65);
        float cosTheta = dot(tang, normalize(vel));
        float doppler = pow(clamp(1.0 + vOrb * cosTheta, 0.38, 1.9), 2.6);

        float temp = clamp(pow(diskIn / hr, 0.68) * 0.78 + rings * 0.28 + (doppler - 1.0) * 0.25, 0.0, 1.0);
        vec3 diskCol = blackbody(temp) * doppler * 1.35;
        // 靠内缘微弱蓝移边缘
        diskCol += vec3(0.35, 0.55, 1.0) * max(0.0, doppler - 1.32) * 0.35;

        float alpha = clamp(density * 0.92, 0.0, 0.96);
        col += trans * diskCol * alpha;
        trans *= (1.0 - alpha);
        if (trans < 0.02) break;
      }
    }
  }

  // 光子环余晖（贴近 r = 1.5*RS 擦过的光线）
  float photonGlow = exp(-abs(minR - 1.56) * 5.4) * (captured ? 0.25 : 0.75);
  col += trans * vec3(1.0, 0.54, 0.24) * photonGlow * 0.95;

  if (!captured && trans > 0.01) {
    col += trans * sampleSky(normalize(vel));
  }

  // 色调映射 + 与页面背景无缝融合
  col = col / (1.0 + col * 0.55);
  col = pow(max(col, 0.0), vec3(0.94));

  vec3 darkBg = vec3(0.031, 0.031, 0.043);   // #08080b
  vec3 lightBg = vec3(0.918, 0.910, 0.886);  // #eae8e2

  // 四周渐晕融合到页面背景
  float vignette = smoothstep(1.22, 0.38, length((v_uv - 0.5) * vec2(1.45, 1.75)));
  vec3 voidCol = mix(darkBg, col + darkBg * 0.35, vignette);

  // 照相底片（PLATE）模式：反相底片 + 轻微暖纸色调
  vec3 plateCol = lightBg - col * vec3(0.88, 0.92, 0.96);
  plateCol = clamp(mix(lightBg, plateCol, vignette), 0.0, 1.0);

  vec3 finalCol = mix(voidCol, plateCol, u_plate);
  gl_FragColor = vec4(finalCol, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function loadSkyTexture(
  gl: WebGLRenderingContext,
  src: string,
  onReady: () => void,
): WebGLTexture | null {
  if (!src) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 8, 11, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let hostIdx = 0;
  const tryLoad = (urlStr: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        onReady();
      } catch {
        /* 非 CORS 图片安全降级为纯程序星空 */
      }
    };
    img.onerror = () => {
      try {
        const u = new URL(urlStr, location.href);
        if (CDN_HOSTS.includes(u.hostname) && hostIdx < CDN_HOSTS.length - 1) {
          hostIdx += 1;
          u.hostname = CDN_HOSTS[hostIdx];
          tryLoad(u.href);
        }
      } catch {
        /* ignore */
      }
    };
    img.src = urlStr;
  };
  tryLoad(src);
  return tex;
}

export function initBlackHole() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-disk]');
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!canvas || !hero) return;

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    hero.dataset.diskMode = 'fallback';
    return;
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) {
    hero.dataset.diskMode = 'fallback';
    return;
  }

  const prog = gl.createProgram();
  if (!prog) return;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    hero.dataset.diskMode = 'fallback';
    return;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const locPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uMouse = gl.getUniformLocation(prog, 'u_mouse');
  const uScroll = gl.getUniformLocation(prog, 'u_scroll');
  const uPlate = gl.getUniformLocation(prog, 'u_plate');
  const uHasTex = gl.getUniformLocation(prog, 'u_hasTex');
  const uTexFade = gl.getUniformLocation(prog, 'u_texFade');
  const uSky = gl.getUniformLocation(prog, 'u_sky');

  let hasTex = 0;
  let texFade = 0;
  const skySrc = canvas.dataset.skySrc || '';
  const tex = loadSkyTexture(gl, skySrc, () => {
    hasTex = 1;
    if (reduceMotion) renderOnce();
  });
  if (tex) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uSky, 0);
  }

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dprCap = Math.min(window.devicePixelRatio || 1, 1.25);
  let width = 1;
  let height = 1;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width * dprCap));
    height = Math.max(1, Math.round(rect.height * dprCap));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };
  resize();
  window.addEventListener('resize', () => {
    resize();
    if (reduceMotion) renderOnce();
  });

  let mx = 0;
  let my = 0;
  let tmx = 0;
  let tmy = 0;
  let scrollDepth = 0;
  let plateVal = document.documentElement.dataset.theme === 'light' ? 1 : 0;
  let plateTarget = plateVal;

  if (matchMedia('(pointer: fine)').matches) {
    window.addEventListener(
      'pointermove',
      (e) => {
        tmx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
        tmy = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      },
      { passive: true },
    );
  }

  const syncScroll = () => {
    const h = Math.max(1, hero.offsetHeight);
    scrollDepth = Math.min(1, Math.max(0, window.scrollY / h));
  };
  window.addEventListener('scroll', syncScroll, { passive: true });
  syncScroll();

  document.addEventListener('hz:theme-change', (e) => {
    const theme = (e as CustomEvent<{ theme?: string }>).detail?.theme;
    plateTarget = theme === 'light' ? 1 : 0;
    if (reduceMotion) {
      plateVal = plateTarget;
      renderOnce();
    }
  });

  let startTime = performance.now();
  let lastFrame = startTime;
  let slowFrames = 0;
  let visible = true;
  let raf = 0;

  const draw = (now: number) => {
    const dt = now - lastFrame;
    lastFrame = now;

    if (!reduceMotion && dt > 36) {
      slowFrames += 1;
      if (slowFrames > 14 && dprCap > 0.72) {
        dprCap = 0.72;
        slowFrames = 0;
        resize();
      }
    } else {
      slowFrames = 0;
    }

    mx += (tmx - mx) * 0.06;
    my += (tmy - my) * 0.06;
    plateVal += (plateTarget - plateVal) * 0.14;
    if (hasTex && texFade < 1) texFade = Math.min(1, texFade + 0.04);

    gl.uniform2f(uRes, width, height);
    gl.uniform1f(uTime, reduceMotion ? 1.2 : (now - startTime) * 0.001);
    gl.uniform2f(uMouse, mx, my);
    gl.uniform1f(uScroll, scrollDepth);
    gl.uniform1f(uPlate, plateVal);
    gl.uniform1f(uHasTex, hasTex);
    gl.uniform1f(uTexFade, reduceMotion && hasTex ? 1 : texFade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  function renderOnce() {
    if (hasTex) texFade = 1;
    draw(performance.now());
  }

  const tick = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    draw(now);
    if (!reduceMotion) {
      raf = requestAnimationFrame(tick);
    }
  };

  const startLoop = () => {
    if (reduceMotion) {
      renderOnce();
      return;
    }
    if (!raf && visible && !document.hidden) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const stopLoop = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) startLoop();
        else stopLoop();
      },
      { threshold: 0.02 },
    ).observe(hero);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else startLoop();
  });

  hero.dataset.diskMode = 'webgl';
  startLoop();
}

initBlackHole();
