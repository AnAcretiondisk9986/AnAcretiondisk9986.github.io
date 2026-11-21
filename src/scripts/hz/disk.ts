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
uniform float u_pulse;
uniform float u_flare;
uniform float u_hasTex;
uniform float u_texFade;
uniform sampler2D u_sky;

#define STEPS 160
#define RS 1.0
#define TAU 6.28318530718
#define INV_TAU 0.15915494309

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx + 17.13) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash31(vec3 p) {
  p = fract((p + vec3(13.7, 29.3, 7.1)) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec2 rot2(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

// 3D 值噪声：z 轴按 256 周期无缝包裹，配合旋转单位圆矢量实现 360° 零接缝螺旋演化
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float z0 = mod(i.z, 256.0);
  float z1 = mod(i.z + 1.0, 256.0);

  float n000 = hash31(vec3(i.x,       i.y,       z0));
  float n100 = hash31(vec3(i.x + 1.0, i.y,       z0));
  float n010 = hash31(vec3(i.x,       i.y + 1.0, z0));
  float n110 = hash31(vec3(i.x + 1.0, i.y + 1.0, z0));

  float n001 = hash31(vec3(i.x,       i.y,       z1));
  float n101 = hash31(vec3(i.x + 1.0, i.y,       z1));
  float n011 = hash31(vec3(i.x,       i.y + 1.0, z1));
  float n111 = hash31(vec3(i.x + 1.0, i.y + 1.0, z1));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);

  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

vec3 blackbody(float t) {
  // 高对比度炽烈黑体等离光谱：暗黑余烬 -> 深炽红 -> 烈焰等离橙 -> 熔金 -> 白炽核
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.32, 0.01, 0.005);
  vec3 c1 = vec3(0.95, 0.16, 0.01);
  vec3 c2 = vec3(1.00, 0.50, 0.04);
  vec3 c3 = vec3(1.00, 0.82, 0.34);
  vec3 c4 = vec3(1.00, 0.97, 0.84);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.55) return mix(c1, c2, (t - 0.25) / 0.30);
  if (t < 0.84) return mix(c2, c3, (t - 0.55) / 0.29);
  return mix(c3, c4, (t - 0.84) / 0.16);
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

// 无极区与接缝的立方体贴图程序星场（高密度针尖星点 + 引力透镜微弧）
vec3 sampleSky(vec3 dir, float lensing) {
  vec3 ad = abs(dir);
  vec2 suv;
  float faceId;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    suv = dir.yz / ad.x;
    faceId = dir.x > 0.0 ? 0.0 : 1.0;
  } else if (ad.y >= ad.x && ad.y >= ad.z) {
    suv = dir.xz / ad.y;
    faceId = dir.y > 0.0 ? 2.0 : 3.0;
  } else {
    suv = dir.xy / ad.z;
    faceId = dir.z > 0.0 ? 4.0 : 5.0;
  }

  float band = exp(-abs(dir.y) * 3.5);
  float dust = vnoise3(dir * 2.8 + vec3(4.2, 1.7, 9.1));
  vec3 cosmos = mix(vec3(0.005, 0.006, 0.012), vec3(0.024, 0.028, 0.062), band * (0.55 + 0.65 * dust));
  cosmos += vec3(0.042, 0.014, 0.007) * band * smoothstep(0.48, 0.92, dust);

  vec2 uv01 = suv * 0.5 + 0.5;

  vec2 g1 = uv01 * 144.0;
  vec2 id1 = floor(g1);
  vec2 fv1 = fract(g1) - 0.5;
  float h1 = hash21(id1 + faceId * 131.0);
  float s1 = smoothstep(0.986, 0.9994, h1) * smoothstep(0.22, 0.02, length(fv1));
  vec3 stars = mix(vec3(1.0, 0.80, 0.52), vec3(0.45, 0.72, 1.0), hash21(id1 + faceId * 71.0 + 7.1)) * s1 * 2.1;

  vec2 g2 = uv01 * 260.0;
  vec2 id2 = floor(g2);
  vec2 fv2 = fract(g2) - 0.5;
  float s2 = smoothstep(0.992, 0.9996, hash21(id2 + faceId * 197.0)) * smoothstep(0.18, 0.015, length(fv2));
  stars += vec3(0.78, 0.86, 1.0) * s2 * 1.1;

  return cosmos + stars * lensing;
}

// 无缝极坐标加速发光物质团块/拖尾流束层（严格按整数 N 周向周期包裹，零接缝）
vec2 evalClumpLayer(
  float ang01,
  float hr,
  float dr,
  float N,
  float spiralC,
  float infallV,
  float seedOff,
  float radialRangeMin,
  float radialRangeMax,
  float aaSoft
) {
  float bandMask = smoothstep(radialRangeMin, radialRangeMin + 0.30, hr)
                 * smoothstep(radialRangeMax, radialRangeMax - 0.90, hr);
  if (bandMask <= 0.001) return vec2(0.0);

  float invSqrtR = inversesqrt(max(hr, 0.55));
  float angSpiral01 = fract(ang01 + (spiralC * INV_TAU) * invSqrtR);
  float rAdv = hr + mod(infallV * u_time, 256.0 * dr);

  float rCoord = rAdv / dr;
  float aCoord = angSpiral01 * N;

  float ir0 = floor(rCoord);
  float fr = fract(rCoord);
  float ia0 = mod(floor(aCoord), N);
  float fa = fract(aCoord);

  float glowSum = 0.0;
  float heatSum = 0.0;

  // 局部 3x3 邻域：粒子偏移与轮廓严格在 0.70 单元内归零，绝不截断或产生接缝
  for (int j = -1; j <= 1; j++) {
    float cellR = mod(ir0 + float(j) + 256.0, 256.0);
    for (int k = -1; k <= 1; k++) {
      float cellA = mod(ia0 + float(k) + N, N);
      vec2 seed = vec2(cellR + seedOff * 19.3, cellA + seedOff * 37.7);
      float presence = hash21(seed);
      if (presence < 0.30) continue;

      float h1 = hash21(seed + vec2(11.3, 27.9));
      float h2 = hash21(seed + vec2(43.7, 9.1));
      float h3 = hash21(seed + vec2(71.9, 53.3));

      float offR = (h1 - 0.5) * 0.44;
      float offA = (h2 - 0.5) * 0.44;

      float dR = float(j) + offR - fr;
      float dA = float(k) + offA - fa;

      float env = smoothstep(0.70, 0.40, abs(dA)) * smoothstep(0.70, 0.40, abs(dR));
      if (env <= 0.0) continue;

      // 越接近黑洞视界，物质被潮汐拉伸得越细长且速度感越强
      float innerTight = mix(0.30, 0.44, clamp((hr - 1.42) / 5.2, 0.0, 1.0)) * aaSoft;
      // 顺行前缘紧凑锐利，后方（dA < 0）拖拽出炽热彗星等离子尾迹
      float tailSpan = dA < 0.0 ? 0.68 : 0.21;

      float nr = dR / innerTight;
      float na = dA / tailSpan;
      float tail = env * exp(-(nr * nr * 3.2 + na * na * 2.8));

      float nrCore = dR / (innerTight * 0.55);
      float naCore = dA / (0.20 * aaSoft);
      float head = env * exp(-(nrCore * nrCore * 3.0 + naCore * naCore * 4.2));

      float lum = (0.48 + 0.92 * pow(presence, 1.4)) * (tail * 0.86 + head * 1.45 / aaSoft);
      glowSum += lum;
      heatSum += lum * (0.42 + 0.58 * h3);
    }
  }

  return vec2(glowSum, heatSum) * bandMask;
}

void main() {
  vec2 aspect = vec2(u_res.x / max(u_res.y, 1.0), 1.0);
  // 宽屏把黑洞放置在右侧黄金视点，给左侧标题让出构图呼吸空间
  float shiftX = mix(0.0, 0.19, smoothstep(1.05, 1.5, aspect.x));
  vec2 p = (v_uv - 0.5) * 2.0 * aspect - vec2(shiftX * aspect.x, 0.0);

  // 更富有张力的近距视角 + 呼吸微动 + 鼠标视差 + 滚屏下潜
  float camDist = mix(8.75, 4.75, clamp(u_scroll, 0.0, 1.0)) + 0.16 * sin(u_time * 0.37);
  float yaw = u_mouse.x * 0.36 + u_time * 0.085;
  float pitch = 0.24 - u_mouse.y * 0.23 + u_scroll * 0.15 + 0.022 * sin(u_time * 0.29);

  vec3 ro = vec3(
    camDist * cos(pitch) * sin(yaw),
    camDist * sin(pitch),
    camDist * cos(pitch) * cos(yaw)
  );
  vec3 target = vec3(0.0, 0.0, 0.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  float roll = -0.17 + u_mouse.x * 0.075 + 0.018 * cos(u_time * 0.24);
  vec3 rTilt = right * cos(roll) + up * sin(roll);
  vec3 uTilt = up * cos(roll) - right * sin(roll);
  vec3 rd = normalize(fwd * 1.60 + rTilt * p.x + uTilt * p.y);

  vec3 hVec = cross(ro, rd);
  float h2 = dot(hVec, hVec);

  vec3 pos = ro;
  vec3 vel = rd;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float minR = 1e6;
  bool captured = false;
  int crossings = 0;

  float diskIn = 1.40;
  float diskOut = 8.50;
  float plasmaShift = mod(0.84 * u_time, 512.0);
  float coronaShift = mod(1.05 * u_time, 256.0);

  for (int i = 0; i < STEPS; i++) {
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < RS) {
      captured = true;
      break;
    }
    if (r > 14.5 && dot(pos, vel) > 0.0) {
      break;
    }

    // 平滑自适应步长（远距大步快进、近视界精步积分，彻底杜绝步数耗尽截断边）
    float dt = clamp(0.082 * (r - 0.86), 0.026, 0.85);
    float nearDisk = (1.0 - smoothstep(0.18, 0.85, abs(pos.y))) * (1.0 - smoothstep(diskOut, diskOut + 1.4, r));
    dt = mix(dt, min(dt, 0.135), nearDisk);

    // 体积化高温日冕与内盘三维热等离子晕
    if (abs(pos.y) < 0.86 && r > 1.24 && r < 7.9) {
      float hrV = length(pos.xz);
      float H = 0.11 + 0.032 * hrV + 0.22 * exp(-(hrV - 1.85) * (hrV - 1.85));
      float vEnv = exp(-(pos.y * pos.y) / (H * H));
      if (vEnv > 0.04 && hrV > 1.30) {
        vec2 dirV = pos.xz / max(hrV, 1e-4);
        float spV = 14.5 * inversesqrt(max(hrV, 0.55));
        float rAdvV = hrV + coronaShift;
        float vn = vnoise3(vec3(rot2(dirV, spV) * 3.1, rAdvV * 0.75));
        float vr = smoothstep(1.30, 1.96, hrV) * smoothstep(7.9, 2.1, hrV);

        vec3 tangV = normalize(vec3(-pos.z, 0.0, pos.x));
        float vOrbV = clamp(0.72 * inversesqrt(hrV), 0.0, 0.76);
        float dopV = pow(clamp(1.0 + vOrbV * dot(tangV, vel), 0.28, 2.30), 2.4);

        float vDens = vEnv * vr * (0.18 + 0.82 * vn * vn);
        float vTemp = clamp(pow(1.42 / hrV, 0.68) * 0.68 + vn * 0.24 + (dopV - 1.0) * 0.14, 0.0, 1.0);
        vec3 vCol = blackbody(vTemp) * dopV * 1.05;
        float vAlpha = clamp(vDens * dt * 0.76, 0.0, 0.34);
        col += trans * vCol * vAlpha;
        trans *= (1.0 - vAlpha * 0.50);
        if (trans < 0.015) break;
      }
    }

    vec3 prevPos = pos;
    // RK2 中点法严格守恒角动量积分史瓦西零测地线
    float invR5 = 1.0 / max(r2 * r2 * r, 0.025);
    vec3 acc1 = -1.5 * h2 * pos * invR5;
    vec3 midVel = normalize(vel + acc1 * (0.5 * dt));
    vec3 midPos = pos + midVel * (0.5 * dt);
    float mr2 = dot(midPos, midPos);
    float mr = sqrt(mr2);
    float minvR5 = 1.0 / max(mr2 * mr2 * mr, 0.025);
    vec3 acc2 = -1.5 * h2 * midPos * minvR5;
    vel = normalize(vel + acc2 * dt);
    pos += midVel * dt;

    // 连续线段最近距计算（消除光子环离散步进虚线噪点）
    vec3 seg = pos - prevPos;
    float tSeg = clamp(-dot(prevPos, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
    minR = min(minR, length(prevPos + seg * tSeg));

    // 严格单次赤道面穿越判定
    if ((prevPos.y > 0.0 && pos.y <= 0.0) || (prevPos.y < 0.0 && pos.y >= 0.0)) {
      float frac = abs(prevPos.y) / max(abs(prevPos.y - pos.y), 1e-5);
      vec3 hit = mix(prevPos, pos, frac);
      float hr = length(hit.xz);
      if (hr > diskIn && hr < diskOut) {
        crossings += 1;
        // 综合光线偏折角、是否绕过黑洞背面与二次穿越次数做物理低通抗锯齿，彻底消灭压缩透镜环噪点
        float bend = 1.0 - clamp(dot(rd, normalize(vel)), -1.0, 1.0);
        float isBack = dot(hit, ro) < 0.0 ? 0.55 : 0.0;
        float lensAA = smoothstep(0.18, 0.90, bend) + (crossings > 1 ? 0.95 : 0.0) + isBack * smoothstep(0.08, 0.35, bend);
        float aaSoft = min(1.0 + 1.35 * lensAA, 2.15);
        float midMask = smoothstep(1.45, 0.20, lensAA);
        float highMask = smoothstep(0.85, 0.08, lensAA);
        float clumpMacroMask = smoothstep(1.85, 0.45, lensAA);
        float clumpDetailMask = smoothstep(1.10, 0.25, lensAA);

        vec2 dirXZ = hit.xz / hr;
        float invSqrtR = inversesqrt(max(hr, 0.55));
        float spiralAngle = 15.8 * invSqrtR;
        vec2 pRot = rot2(dirXZ, spiralAngle);
        float rAdv = hr + plasmaShift;

        // 4 层严格无缝旋转 3D 螺旋等离子体湍流（随透镜压缩自动平滑降频）
        float warp = vnoise3(vec3(pRot * 2.4, rAdv * 0.5));
        vec2 pWarp1 = rot2(pRot, (warp - 0.5) * 1.25);
        float arms = mix(0.54, vnoise3(vec3(pWarp1 * 5.0, rAdv * 1.0)), 0.25 + 0.75 * midMask);
        vec2 pWarp2 = rot2(pRot, (arms - 0.5) * 1.55 + (warp - 0.5) * 0.75);
        float streams = mix(0.50, vnoise3(vec3(pWarp2 * 10.0, rAdv * 2.0)), highMask);
        float fine = mix(0.50, vnoise3(vec3(rot2(pRot, (streams - 0.5) * 1.2) * 18.0, rAdv * 4.0)), highMask * highMask);

        // 深邃磁力剪切暗隙 + 脊状炽白等离子丝纹（暗隙反衬出高速加速绕转的发光物质）
        float ridge = 1.0 - abs(2.0 * streams - 1.0);
        float filaments = pow(clamp(ridge, 0.0, 1.0), 1.85);
        float lanes = 0.09 + 0.91 * pow(smoothstep(0.20, 0.90, arms * 0.54 + filaments * 0.46), 1.48);

        float radialFade = smoothstep(diskIn, diskIn + 0.26, hr) * smoothstep(diskOut, 2.30, hr);
        float gravRedshift = sqrt(clamp(1.0 - 0.96 / max(hr, 1.02), 0.12, 1.0));

        float plasmaDensity = radialFade * (0.12 + 0.88 * arms) * (0.45 + 0.75 * fine) * lanes;

        // 三层流畅、无锯齿、加速绕转的发光物质团块与炽热彗星拖尾
        float ang01 = atan(hit.z, hit.x) * INV_TAU + 0.5;
        vec2 cMacro = evalClumpLayer(ang01, hr, 0.92, 10.0, 14.0, 0.68, 1.0, diskIn + 0.15, diskOut - 0.2, aaSoft) * clumpMacroMask;
        vec2 cMid   = evalClumpLayer(ang01, hr, 0.54, 17.0, 17.5, 0.98, 2.0, diskIn + 0.05, diskOut - 0.9, aaSoft) * clumpDetailMask;
        vec2 cInner = evalClumpLayer(ang01, hr, 0.36, 24.0, 21.5, 1.38, 3.0, diskIn,        4.5,           aaSoft) * clumpDetailMask;

        float clumpLum = cMacro.x * 1.15 + cMid.x * 1.65 + cInner.x * 2.15;
        float clumpHeat = (cMacro.y * 1.15 + cMid.y * 1.65 + cInner.y * 2.15) / max(clumpLum, 1e-4);

        // 强相对论多普勒聚束
        vec3 tang = normalize(vec3(-hit.z, 0.0, hit.x));
        float vOrb = clamp(0.75 * invSqrtR, 0.0, 0.78);
        float cosTheta = dot(tang, normalize(vel));
        float doppler = pow(clamp(1.0 + vOrb * cosTheta, 0.26, 2.35), 2.95);

        float baseTemp = pow(diskIn / hr, 0.68) * 0.70 + arms * 0.20 + filaments * 0.18 + (doppler - 1.0) * 0.16;
        float totalTemp = clamp(baseTemp + clamp(clumpLum * 0.24, 0.0, 0.45), 0.0, 1.0);

        // 适度压低连续背景底盘亮度，让高能发光团块与灼热丝纹在整张盘面鲜明跃出
        vec3 diskCol = blackbody(totalTemp) * doppler * 1.22;
        vec3 clumpCol = mix(vec3(1.00, 0.44, 0.04), vec3(1.00, 0.96, 0.76), clamp(clumpHeat, 0.0, 1.0));
        diskCol += clumpCol * clumpLum * doppler * (1.75 + 0.85 * smoothstep(4.6, 1.5, hr));

        // 顺行极速内缘等离子蓝移电弧 + 逆行侧深红余烬
        diskCol += vec3(0.28, 0.62, 1.00) * pow(max(0.0, doppler - 1.46), 1.35) * (0.22 + 0.48 * cInner.x);
        diskCol += vec3(0.60, 0.03, 0.03) * max(0.0, 1.0 - doppler) * 0.44;
        diskCol *= gravRedshift;

        float alpha = clamp((plasmaDensity * 0.82 + clumpLum * 0.72 * radialFade), 0.0, 0.985);
        col += trans * diskCol * alpha;
        trans *= (1.0 - alpha);
        if (trans < 0.015) break;
      }
    }
  }

  // 若光线在临界轨道缠绕耗尽步数且仍困在光子球内侧，视为被视界捕获，防止漏出背景星点
  if (!captured && minR < 1.46) {
    captured = true;
  }

  // 锐利顺滑双阶爱因斯坦光子环 + 绕环疾驰的相对论耀斑脉冲（完全连续无阶跃）
  vec2 screenDir = p / max(length(p), 1e-4);
  float ringPulse1 = vnoise3(vec3(rot2(screenDir, -u_time * 2.45) * 4.5, mod(u_time * 0.70, 256.0)));
  float ringPulse2 = vnoise3(vec3(rot2(screenDir, -u_time * 4.25) * 8.5, mod(u_time * 1.15, 256.0)));
  float ringArc = 0.72 + 0.68 * smoothstep(0.38, 0.92, ringPulse1 * 0.6 + ringPulse2 * 0.4);
  float ringDoppler = 1.0 - 0.34 * clamp(p.x * 0.42, -1.0, 1.0);

  float escapeFade = smoothstep(1.36, 1.52, minR);
  float sharpRing = exp(-abs(minR - 1.50) * 14.5) * mix(0.48, 1.45, escapeFade);
  float secondaryRing = exp(-abs(minR - 1.56) * 6.8) * mix(0.28, 0.95, escapeFade);
  float coronaGlow = exp(-abs(minR - 1.62) * 3.0) * mix(0.18, 0.82, escapeFade);

  float ringBoost = 1.0 + 0.42 * u_scroll + 0.36 * u_flare + 0.65 * u_pulse;

  col += trans * (
    vec3(1.00, 0.92, 0.66) * sharpRing * 1.78 * ringArc +
    vec3(1.00, 0.48, 0.08) * secondaryRing * 1.36 * (0.85 + 0.3 * ringPulse1) +
    vec3(1.00, 0.24, 0.04) * coronaGlow * 1.22
  ) * ringDoppler * ringBoost;

  // 极区同步辐射等离子日冕 + 点击触发的南北极相对论高能喷流射线（Blazar / Quasar Bipolar Jets）
  vec2 pAxis = rot2(p, roll);
  float absY = abs(pAxis.y);
  float absX = abs(pAxis.x);
  // 抛物线磁喷嘴准直包络：从南北极事件视界附近极窄束流向外柔和扩散
  float nozzleW = 0.036 + 0.068 * pow(max(absY - 0.25, 0.0), 0.92);
  float idleCore = exp(-pow(absX / (nozzleW * 1.35), 2.0)) * smoothstep(0.30, 0.72, absY) * smoothstep(1.95, 0.65, length(pAxis));
  if (idleCore > 0.004) {
    float jetNoise = vnoise3(vec3(pAxis * vec2(10.0, 2.2), mod(u_time * 1.6, 256.0) - absY * 2.4));
    float jetStreak = pow(clamp(jetNoise, 0.0, 1.0), 2.0) * idleCore;
    vec3 jetCol = mix(vec3(0.32, 0.66, 1.00), vec3(1.00, 0.68, 0.34), smoothstep(0.55, 1.35, absY));
    col += trans * jetCol * jetStreak * (0.48 + 0.42 * u_flare);
  }

  // 点击黑洞时从南北极沿磁轴猛烈喷射相对论高能射线束（无廉价同心圆波）
  if (u_pulse > 0.002) {
    float progress = 1.0 - u_pulse;
    float envFade = pow(u_pulse, 0.72) * smoothstep(0.0, 0.08, progress);
    // 主喷流前方高速激波锋面，从视界两极沿南北极磁轴冲出至画面外缘
    float frontY = mix(0.28, 3.10, pow(progress, 0.78));
    float tailLen = mix(0.35, 1.45, progress);
    float beamTravel = smoothstep(0.24, 0.48, absY) * smoothstep(frontY + 0.28, frontY - 0.12, absY);
    float beamTrail = exp(-max(0.0, frontY - absY) / max(tailLen, 0.1));

    // 紧束准直内核 + 外围激波羽鞘 + 高速等离子节结纹理
    float jetNozzle = 0.022 + 0.052 * pow(max(absY - 0.24, 0.0), 0.85);
    float beamCore = exp(-pow(absX / (jetNozzle * 0.55), 2.0));
    float beamSheath = exp(-pow(absX / (jetNozzle * 2.15), 2.0));
    float beamRays = vnoise3(vec3(pAxis.x / max(jetNozzle, 0.02) * 1.4, absY * 5.2 - progress * 9.5, mod(u_time * 1.8, 256.0)));
    float filament = 0.45 + 0.95 * pow(clamp(beamRays, 0.0, 1.0), 1.6);

    float jetIntensity = beamTravel * beamTrail * envFade * filament;
    vec3 coreCol = vec3(0.86, 0.94, 1.00) * beamCore * 2.35;
    vec3 plasmaCol = mix(vec3(0.32, 0.66, 1.00), vec3(1.00, 0.52, 0.14), smoothstep(0.45, 2.0, absY)) * beamSheath * 1.15;
    col += (coreCol + plasmaCol) * jetIntensity;

    // 南北极出口短暂磁重联耀斑
    float northPole = length(pAxis - vec2(0.0, 0.36));
    float southPole = length(pAxis + vec2(0.0, 0.36));
    float poleFlash = (exp(-northPole * 7.5) + exp(-southPole * 7.5)) * pow(u_pulse, 1.35);
    col += vec3(0.75, 0.88, 1.00) * poleFlash * 0.95;
  }

  // 下潜越过视界时的径向光学速度流线
  if (u_scroll > 0.05) {
    float radAngle = atan(p.y, p.x);
    float streakNoise = vnoise3(vec3(cos(radAngle) * 14.0, sin(radAngle) * 14.0, mod(u_time * 2.2 + u_scroll * 6.0, 256.0)));
    float edgeMask = smoothstep(0.65, 1.65, length(p)) * u_scroll;
    col += vec3(1.00, 0.62, 0.28) * pow(clamp(streakNoise, 0.0, 1.0), 4.0) * edgeMask * 0.52;
  }

  float lensingBoost = 1.0 + 2.25 * exp(-abs(minR - 1.72) * 2.1);
  if (!captured && trans > 0.01) {
    col += trans * sampleSky(normalize(vel), lensingBoost);
  }

  // ACES 色调映射 + 高饱和保持
  col = acesTone(col * 1.04);
  col = boostSaturation(col, 1.28);

  vec3 darkBg = vec3(0.031, 0.031, 0.043);   // #08080b
  vec3 lightBg = vec3(0.918, 0.910, 0.886);  // #eae8e2

  float vignette = smoothstep(1.42, 0.40, length((v_uv - 0.5) * vec2(1.26, 1.56)));
  vec3 voidCol = mix(darkBg, max(col, darkBg * 0.72), vignette);

  // 白洞 / 照相底片（PLATE）模式：高饱和度冷蔚蓝 + 炽烈朱砂反相光谱，按透射率平滑保留纯白奇点核（杜绝前盘撕裂）
  vec3 invTone = vec3(
    pow(col.r, 0.88) * 0.25 + col.g * 0.65 + col.b * 0.75,
    pow(col.g, 0.92) * 0.45 + col.r * 0.45,
    col.r * 0.22 + col.g * 0.14
  );
  vec3 plateCol = clamp(lightBg - invTone * 1.06, 0.0, 1.0);
  if (captured) {
    plateCol = mix(plateCol, vec3(0.972, 0.966, 0.946), 0.82 * trans);
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
  const uPulse = gl.getUniformLocation(prog, 'u_pulse');
  const uFlare = gl.getUniformLocation(prog, 'u_flare');
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
  const isFine = matchMedia('(pointer: fine)').matches;
  let dprCap = Math.min(window.devicePixelRatio || 1, isFine ? 1.35 : 1.0);
  let width = 1;
  let height = 1;
  let heroHeight = Math.max(1, hero.offsetHeight);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    heroHeight = Math.max(1, rect.height || hero.offsetHeight);
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
  }, { passive: true });

  let mx = 0;
  let my = 0;
  let tmx = 0;
  let tmy = 0;
  let scrollDepth = 0;
  let plateVal = document.documentElement.dataset.theme === 'light' ? 1 : 0;
  let plateTarget = plateVal;
  let pulseVal = 0;
  let flareVal = 0;
  let flareTarget = 0;

  if (matchMedia('(pointer: fine)').matches) {
    window.addEventListener(
      'pointermove',
      (e) => {
        tmx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
        tmy = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const bhCenterX = aspect > 1.2 ? 0.66 : 0.5;
        const distBH = Math.hypot(e.clientX / Math.max(1, window.innerWidth) - bhCenterX, e.clientY / Math.max(1, window.innerHeight) - 0.5);
        flareTarget = Math.max(0, Math.min(1, 1 - distBH / 0.45));
      },
      { passive: true },
    );
  }

  if (!reduceMotion) {
    hero.addEventListener(
      'pointerdown',
      () => {
        pulseVal = 1.0;
      },
      { passive: true },
    );
  }

  const syncScroll = () => {
    scrollDepth = Math.min(1, Math.max(0, window.scrollY / heroHeight));
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

  let firstFrame = false;

  const draw = (now: number) => {
    const dt = now - lastFrame;
    lastFrame = now;

    if (!reduceMotion && dt > 36) {
      slowFrames += 1;
      if (slowFrames > 5 && dprCap > 0.75) {
        dprCap = Math.max(0.75, +(dprCap * 0.8).toFixed(2));
        slowFrames = 0;
        resize();
      }
    } else {
      slowFrames = 0;
    }

    mx += (tmx - mx) * 0.06;
    my += (tmy - my) * 0.06;
    plateVal += (plateTarget - plateVal) * 0.14;
    flareVal += (flareTarget - flareVal) * 0.08;
    if (pulseVal > 0.001) {
      pulseVal = Math.max(0, pulseVal - Math.min(0.05, dt * 0.001) * 0.54);
    }
    if (hasTex && texFade < 1) texFade = Math.min(1, texFade + 0.04);

    gl.uniform2f(uRes, width, height);
    gl.uniform1f(uTime, reduceMotion ? 1.2 : (now - startTime) * 0.001);
    gl.uniform2f(uMouse, mx, my);
    gl.uniform1f(uScroll, scrollDepth);
    gl.uniform1f(uPlate, plateVal);
    gl.uniform1f(uPulse, reduceMotion ? 0 : pulseVal);
    gl.uniform1f(uFlare, reduceMotion ? 0 : flareVal);
    gl.uniform1f(uHasTex, hasTex);
    gl.uniform1f(uTexFade, reduceMotion && hasTex ? 1 : texFade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!firstFrame) {
      firstFrame = true;
      canvas.classList.add('is-ready');
    }
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

// 延后到首帧文字渲染之后再编译 WebGL 着色器，避免阻塞首屏 DCL 与 LCP
requestAnimationFrame(() => {
  window.setTimeout(initBlackHole, 0);
});
