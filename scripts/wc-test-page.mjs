// 生成词云调试测试页(暗色主题 + 正确数据格式),build 后运行
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/_astro';
const jsName = readdirSync(dir).find(
  (f) => f.startsWith('WordCloud.astro') && f.endsWith('.js'),
);
if (!jsName) throw new Error('找不到词云打包脚本');

const words = JSON.stringify([
  { text: '健康', count: 61, weight: 72 },
  { text: '图片', count: 39, weight: 61 },
  { text: '压缩', count: 32, weight: 56 },
  { text: '数据', count: 31, weight: 55 },
  { text: '技术', count: 18, weight: 41 },
  { text: '写作', count: 16, weight: 39 },
  { text: '画廊', count: 16, weight: 39 },
  { text: '模板', count: 16, weight: 39 },
  { text: '部署', count: 11, weight: 29 },
  { text: '生成', count: 11, weight: 29 },
  { text: '测试', count: 8, weight: 21 },
  { text: '关键', count: 8, weight: 21 },
  { text: '个人', count: 8, weight: 21 },
  { text: '工具', count: 7, weight: 18 },
  { text: '安全', count: 6, weight: 14 },
  { text: '静态', count: 6, weight: 14 },
  { text: '评论', count: 6, weight: 14 },
  { text: '流程', count: 6, weight: 14 },
]);

const html = `<!DOCTYPE html>
<html data-theme="dark">
<head>
<style>
:root{--paper:#191713;--paper-light:#24211b;--ink:#e7dcc2;--ink-soft:#b7aa91;--red:#b35249;--gold:#b99c60;--gold-light:#dcc48e}
html,body{margin:0;background:#191713}
</style>
</head>
<body>
<div data-wordcloud-box style="width:600px;margin:20px;background:var(--paper-light);border:1px solid #555">
<canvas data-wordcloud data-words='${words}' data-site="https://acretiondisk.top/"></canvas>
<div data-wordcloud-tip hidden></div>
</div>
<pre id="out">waiting</pre>
<script type="module">
window.__log=[];
window.addEventListener('error',e=>{window.__log.push('ERR:'+e.message);});
const __c=document.querySelector('canvas');
['wordcloudstart','wordclouddrawn','wordcloudstop','wordcloudabort'].forEach(t=>__c.addEventListener(t,e=>{
  window.__log.push(t+(e.detail&&e.detail.item?':'+e.detail.item[0]:''));
  if(t==='wordcloudstop'){
    const cx=__c.getContext('2d');
    const dd=cx.getImageData(0,0,__c.width,__c.height).data;
    let an=0;for(let i=3;i<dd.length;i+=4){if(dd[i]>0)an++;}
    window.__log.push('STOP-PIXELS:'+an);
  }
}));
</script>
<script type="module" src="/_astro/${jsName}"></script>
<script type="module">
setTimeout(()=>{
  const c=document.querySelector('canvas');
  const ctx=c.getContext('2d');
  const d=ctx.getImageData(0,0,c.width,c.height).data;
  let an=0,nb=0;
  for(let i=0;i<d.length;i+=4){
    if(d[i+3]>0)an++;
    if(d[i+3]>0&&(d[i]<200||d[i+1]<200||d[i+2]<200))nb++;
  }
  document.getElementById('out').textContent=JSON.stringify({size:c.width+'x'+c.height,alphaNonZero:an,nonBg:nb,log:window.__log});
},6000);
</script>
</body></html>`;

writeFileSync('dist/wc-test.html', html);
console.log('测试页已生成,引用:', jsName);
