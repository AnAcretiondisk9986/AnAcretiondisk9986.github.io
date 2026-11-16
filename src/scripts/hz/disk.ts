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

#define STEPS 112
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
  float a = 0.52;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise2(p);
    p = rot * p * 2.07;
    a *= 0.49;
  }
  return v;
}

vec3 blackbody(float t) {
  // 高饱和度黑体等离子光谱：深绯红 -> 烈焰等离橙 -> 熔金 -> 炽金白
  vec3 c0 = vec3(0.76, 0.04, 0.02);
  vec3 c1 = vec3(1.00, 0.28, 0.01);
  vec3 c2 = vec3(1.00, 0.68, 0.09);
  vec3 c3 = vec3(1.00, 0.94, 0.72);
  if (t < 0.34) return mix(c0, c1, t / 0.34);
  if (t < 0.70) return mix(c1, c2, (t - 0.34) / 0.36);
  return mix(c2, c3, (t - 0.70) / 0.30);
}

vec3 acesTone(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 boostSaturation(vec3 col, float sat) {
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  return max(vec3(0.0), mix(vec3(luma), col, sat));
}

vec3 sampleSky(vec3 dir, float lensing) {
  vec2 sph = vec2(atan(dir.z, dir.x) * 0.15915 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31831 + 0.5);

  // 两层锐利星场 + 引力透镜增亮
  vec2 g1 = sph * vec2(170.0, 85.0);
  vec2 id1 = floor(g1);
  vec2 fv1 = fract(g1) - 0.5;
  float h1 = hash21(id1);
  float s1 = smoothstep(0.986, 0.999, h1) * smoothstep(0.42, 0.04, length(fv1));
  vec3 stars = mix(vec3(1.0, 0.84, 0.62), vec3(0.42, 0.68, 1.0), hash21(id1 + 7.1)) * s1 * 1.9;

  vec2 g2 = sph * vec2(320.0, 160.0);
  vec2 id2 = floor(g2);
  vec2 fv2 = fract(g2) - 0.5;
  float s2 = smoothstep(0.991, 0.9995, hash21(id2)) * smoothstep(0.36, 0.04, length(fv2));
  stars += vec3(0.75, 0.84, 1.0) * s2 * 0.95;

  stars *= lensing;

  if (u_hasTex > 0.5 && u_texFade > 0.01) {
    vec2 uv = dir.xy * vec2(0.46, -0.46) + 0.5;
    uv = clamp(uv, 0.0, 1.0);
    vec3 img = texture2D(u_sky, uv).rgb;
    img = boostSaturation(img, 1.32);
    float edgeMask = smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x)
                   * smoothstep(0.0, 0.15, uv.y) * smoothstep(1.0, 0.85, uv.y);
    stars += img * (0.48 * edgeMask * u_texFade * min(lensing, 1.75));
  }
  return stars;
}

void main() {
  vec2 aspect = vec2(u_res.x / max(u_res.y, 1.0), 1.0);
  // 宽屏把黑洞放置在右侧黄金视点，给左侧标题让出构图呼吸空间
  float shiftX = mix(0.0, 0.19, smoothstep(1.05, 1.5, aspect.x));
  vec2 p = (v_uv - 0.5) * 2.0 * aspect - vec2(shiftX * aspect.x, 0.0);

  // 更近的视距 + 鼠标视差 + 滚屏下潜
  float camDist = mix(9.4, 5.2, clamp(u_scroll, 0.0, 1.0));
  float yaw = u_mouse.x * 0.34 + u_time * 0.065;
  float pitch = 0.23 - u_mouse.y * 0.22 + u_scroll * 0.14;

  vec3 ro = vec3(
    camDist * cos(pitch) * sin(yaw),
    camDist * sin(pitch),
    camDist * cos(pitch) * cos(yaw)
  );
  vec3 target = vec3(0.0, 0.0, 0.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  // 轻微倾斜角让吸积盘更有空间张力
  float roll = -0.14 + u_mouse.x * 0.06;
  vec3 rTilt = right * cos(roll) + up * sin(roll);
  vec3 uTilt = up * cos(roll) - right * sin(roll);
  vec3 rd = normalize(fwd * 1.62 + rTilt * p.x + uTilt * p.y);

  vec3 hVec = cross(ro, rd);
  float h2 = dot(hVec, hVec);

  vec3 pos = ro;
  vec3 vel = rd;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float minR = 1e6;
  bool captured = false;

  float diskIn = 1.88;
  float diskOut = 7.6;

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

    float dt = clamp(0.042 * (r - 0.78), 0.022, 0.42);
    if (abs(pos.y) < 0.35 && r < diskOut + 0.4) {
      dt = min(dt, 0.12);
    }

    vec3 prevPos = pos;
    float r5 = pow(max(r, 0.48), 5.0);
    vec3 acc = -1.5 * h2 * pos / r5;
    vel = normalize(vel + acc * dt);
    pos += vel * dt;

    if (prevPos.y * pos.y <= 0.0) {
      float frac = abs(prevPos.y) / max(abs(prevPos.y - pos.y), 1e-5);
      vec3 hit = mix(prevPos, pos, frac);
      float hr = length(hit.xz);
      if (hr > diskIn && hr < diskOut) {
        float ang = atan(hit.z, hit.x);
        float kepler = u_time * (4.4 / pow(hr, 1.32));
        float spiral = ang + kepler + 7.2 / sqrt(hr);

        // 多尺度剪切等离子体丝状纹理
        float warp = fbm(vec2(hr * 1.6, spiral * 0.4));
        float rings = fbm(vec2(hr * 3.4 + warp * 0.7, spiral * 0.75));
        float fine = noise2(vec2(hr * 13.5, spiral * 2.6 + warp * 1.6));
        float lanes = 0.55 + 0.45 * sin(hr * 9.5 + warp * 3.2);

        float radialFade = smoothstep(diskIn, diskIn + 0.24, hr) * smoothstep(diskOut, diskIn + 1.25, hr);
        float density = radialFade * (0.28 + 0.88 * rings) * (0.55 + 0.55 * fine) * lanes;

        // 强烈相对论多普勒聚束：顺行侧炽热蓝移增亮，逆行侧深红暗沉
        vec3 tang = normalize(vec3(-hit.z, 0.0, hit.x));
        float vOrb = clamp(0.68 / sqrt(hr), 0.0, 0.72);
        float cosTheta = dot(tang, normalize(vel));
        float doppler = pow(clamp(1.0 + vOrb * cosTheta, 0.28, 2.25), 3.0);

        float temp = clamp(pow(diskIn / hr, 0.62) * 0.82 + rings * 0.28 + fine * 0.12 + (doppler - 1.0) * 0.24, 0.0, 1.0);
        vec3 diskCol = blackbody(temp) * doppler * 1.68;
        // 顺行内缘强蓝移电弧 + 逆行外缘深红余烬
        diskCol += vec3(0.24, 0.58, 1.0) * pow(max(0.0, doppler - 1.22), 1.25) * 0.72;
        diskCol += vec3(0.65, 0.04, 0.06) * max(0.0, 1.0 - doppler) * 0.42;

        float alpha = clamp(density * 0.96, 0.0, 0.98);
        col += trans * diskCol * alpha;
        trans *= (1.0 - alpha);
        if (trans < 0.015) break;
      }
    }
  }

  // 双层锐利爱因斯坦光子环 + 炽热日冕耀斑
  float sharpRing = exp(-abs(minR - 1.50) * 14.0) * (captured ? 0.45 : 1.15);
  float coronaGlow = exp(-abs(minR - 1.56) * 4.2) * (captured ? 0.24 : 0.85);
  float shimmer = 0.92 + 0.08 * sin(u_time * 3.1 + atan(p.y, p.x) * 4.0);
  col += trans * (vec3(1.0, 0.84, 0.48) * sharpRing * 1.45 + vec3(1.0, 0.34, 0.04) * coronaGlow * 1.25) * shimmer;

  float lensingBoost = 1.0 + 1.85 * exp(-abs(minR - 1.72) * 2.1);
  if (!captured && trans > 0.01) {
    col += trans * sampleSky(normalize(vel), lensingBoost);
  }

  // ACES 色调映射 + 饱和度增强
  col = acesTone(col * 1.18);
  col = boostSaturation(col, 1.28);

  vec3 darkBg = vec3(0.031, 0.031, 0.043);   // #08080b
  vec3 lightBg = vec3(0.918, 0.910, 0.886);  // #eae8e2

  float vignette = smoothstep(1.36, 0.42, length((v_uv - 0.5) * vec2(1.32, 1.62)));
  vec3 voidCol = mix(darkBg, max(col, darkBg * 0.72), vignette);

  // 白洞 / 照相底片（PLATE）模式：高饱和度冷蔚蓝 + 炽烈朱砂反相光谱，保留纯白奇点核
  vec3 invTone = vec3(
    pow(col.r, 0.88) * 0.25 + col.g * 0.65 + col.b * 0.75,
    pow(col.g, 0.92) * 0.45 + col.r * 0.45,
    col.r * 0.22 + col.g * 0.14
  );
  vec3 plateCol = clamp(lightBg - invTone * 1.08, 0.0, 1.0);
  // 白洞核心奇点微光与光环高饱和点缀
  if (captured) {
    plateCol = mix(plateCol, vec3(0.985, 0.978, 0.955), 0.75 * trans);
  }
  plateCol = boostSaturation(plateCol, 1.26);
  plateCol = mix(lightBg, plateCol, vignette);

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
  let dprCap = Math.min(window.devicePixelRatio || 1, 1.65);
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

    if (!reduceMotion && dt > 42) {
      slowFrames += 1;
      if (slowFrames > 18 && dprCap > 0.95) {
        dprCap = 0.95;
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
