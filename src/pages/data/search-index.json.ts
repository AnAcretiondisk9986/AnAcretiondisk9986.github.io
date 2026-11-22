import type { APIRoute } from 'astro';
import { getPublicPosts } from '../../lib/posts';
import projectsRaw from '../../data/projects.json';
import dailyRaw from '../../data/daily.json';
import academicsRaw from '../../data/academics.json';
import categoriesRaw from '../../data/categories.json';
import { normalizeProjects } from '../../lib/projects';
import { normalizeCategoryList, normalizePostCategories } from '../../lib/categories';

function extractHeadings(markdown: string): string[] {
  const clean = String(markdown || '').replace(/```[\s\S]*?```/g, '');
  const out: string[] = [];
  for (const m of clean.matchAll(/^#{2,3}\s+(.+)$/gm)) {
    const t = m[1].replace(/[*_`~[\]()]/g, '').trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

export const GET: APIRoute = async () => {
  const posts = (await getPublicPosts()).filter((p) => !p.data.access || p.data.access === 'public');
  const categories = normalizeCategoryList(categoriesRaw);
  const projects = normalizeProjects(projectsRaw);
  const dailies = Array.isArray(dailyRaw) ? dailyRaw.slice(0, 50) : [];
  const courses = Array.isArray((academicsRaw as { courses?: unknown[] }).courses)
    ? (academicsRaw as { courses: Array<Record<string, unknown>> }).courses
    : [];

  const payload = {
    generatedAt: new Date().toISOString(),
    channels: [
      { title: '首页 · ORIGIN', desc: '黑洞视界与近期归档', url: '/', kind: 'channel', badge: '01' },
      { title: '文章 · SPECTRUM', desc: '全部文章检索与发射光谱', url: '/blog/', kind: 'channel', badge: '02' },
      { title: '年度 / 阶段观测报告', desc: '自动聚合统计与年度里程碑回顾', url: '/blog/report/', kind: 'channel', badge: '02.1' },
      { title: '日常 · DAILY', desc: '24/7 观测碎片与时间线', url: '/daily/', kind: 'channel', badge: '03' },
      { title: '图像 · LENSING', desc: '摄影与图形档案引力透镜墙', url: '/gallery/', kind: 'channel', badge: '04' },
      { title: '关于 · OBSERVER', desc: '观测者档案、兴趣与词频光谱', url: '/about/', kind: 'channel', badge: '05' },
      { title: '学业 · TRAJECTORY', desc: '双专业转轨课表拼贴与 GPA 遥测', url: '/academics/', kind: 'channel', badge: '06' },
      { title: '日程 · EPHEMERIS', desc: '温医大课程表与时间网格', url: '/schedule/', kind: 'channel', badge: '07' },
      { title: '期末考试日程', desc: '考试倒计时与考场安排', url: '/schedule/exams/', kind: 'channel', badge: '07.1' },
      { title: '额度 · FLUX', desc: '多平台 API 算力额度监控', url: '/ai-quota/', kind: 'channel', badge: '08' },
      { title: '造物 / 实验室 · LAB', desc: '开源项目、Agent 系统与站内实验', url: '/projects/', kind: 'channel', badge: '09' },
      { title: 'RSS 订阅源', desc: '公开文章 RSS 2.0 Feed', url: '/rss.xml', kind: 'channel', badge: 'RSS' },
    ],
    categories: categories.map((c) => ({
      title: `分类：${c.name}`,
      desc: c.description || '点击查看该大类下的文章',
      url: `/blog/?cat=${encodeURIComponent(c.name)}`,
      kind: 'category',
    })),
    posts: posts.map((p) => ({
      id: p.id,
      title: p.data.title,
      desc: p.data.description || '',
      url: `/blog/${encodeURI(p.id)}/`,
      date: p.data.pubDate.toISOString().split('T')[0],
      categories: normalizePostCategories(p.data.categories),
      tags: p.data.tags || [],
      headings: extractHeadings(p.body ?? ''),
    })),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.name,
      desc: p.tagline || p.description || '',
      url: `/projects/#${encodeURIComponent(p.id)}`,
      stack: p.stack || [],
      status: p.status,
    })),
    dailies: dailies.map((d: Record<string, unknown>) => ({
      id: String(d.id || ''),
      title: String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 72) || '(图集动态)',
      date: String(d.date || ''),
      tags: Array.isArray(d.tags) ? d.tags : [],
      url: `/daily/#${encodeURIComponent(String(d.id || ''))}`,
    })),
    courses: courses.map((c) => ({
      id: String(c.id || ''),
      title: String(c.name || ''),
      code: String(c.code || ''),
      dept: String(c.dept || ''),
      grade: String(c.grade || ''),
      url: `/academics/?q=${encodeURIComponent(String(c.name || ''))}`,
    })),
  };

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
