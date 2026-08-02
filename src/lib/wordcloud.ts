/**
 * 构建时运行的词频统计模块。
 * 对全站文章(标题 + 正文)做中文分词并统计词频,
 * 输出 wordcloud2.js 可直接使用的词云数据。
 *
 * 分词使用 Node 内置的 Intl.Segmenter(零依赖),
 * 配合内置停用词表过滤虚词与高频无意义词。
 */

export interface WordCloudWord {
  /** 词语文本 */
  text: string;
  /** 映射后的字号权重(wordcloud2.js 的 weight 字段) */
  weight: number;
  /** 原始词频(出现次数) */
  count: number;
}

const STOPWORDS = new Set([
  // 中文虚词与高频无意义词
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也',
  '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那',
  '什么', '我们', '你们', '他们', '因为', '所以', '但是', '如果', '可以', '觉得', '还是',
  '这个', '那个', '一下', '现在', '时候', '知道', '应该', '可能', '而', '与', '及', '或',
  '之', '其', '它', '他', '她', '被', '把', '让', '从', '向', '对', '于', '地', '得', '过',
  '又', '再', '还', '只', '才', '并', '且', '等', '嗯', '啊', '吧', '呢', '吗', '呀', '哦',
  '哎', '以及', '进行', '通过', '一些', '这些', '那些', '这样', '那样', '怎么', '为什么',
  '如何', '能否', '已经', '正在', '即将', '非常', '十分', '比较', '特别', '比如', '例如',
  '还有', '其中', '大家', '每个', '所有', '各种', '当然', '其实', '真的', '只是', '就是',
  '不是', '是的', '内容', '东西', '事情', '问题', '方式', '方法', '部分', '方面', '起来',
  '出来', '下来', '之后', '之前', '同时', '虽然', '然而', '于是', '由于', '因此', '只要',
  '才能', '必要', '必须', '无法', '不能', '不会', '没有', '什么', '时候', '还有', '另外',
  '最后', '开始', '结束', '今天', '昨天', '明天', '今年', '去年', '博客', '文章',
  // 文档结构词 / 泛动词 / 否定词(词频高但无信息量)
  '参考文献', '正文', '目录', '报告', '论文', '附件', '图表', '字数', '编号',
  '不要', '不得', '避免', '使用', '要求', '提供', '能够', '直接', '选择',
  '数量', '确认', '明确', '解释', '复制', '引用', '访问', '保留', '优先', '水平', '结果',
  // 英文停用词
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its',
  'as', 'by', 'from', 'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very', 'can', 'could',
  'will', 'would', 'should', 'about', 'into', 'over', 'up', 'you', 'your', 'we', 'our', 'they',
  'their', 'he', 'she', 'his', 'her', 'i', 'my', 'me', 'do', 'does', 'did', 'have', 'has',
  'had', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'any', 'some',
  'each', 'more', 'most', 'other', 'such', 'only', 'own', 'same', 'also', 'just', 'like',
  'may', 'might', 'get', 'got', 'make', 'made', 'use', 'used', 'see', 'say', 'go', 'one',
  'two', 'new', 'know', 'think', 'take', 'come', 'want', 'give', 'tell', 'work',
]);

const DEFAULT_MAX_WORDS = 80; // 最多保留的词数
const DEFAULT_MIN_COUNT = 2; // 词至少出现 2 次才入选
const MIN_SIZE = 14; // 最小字号(px)
const MAX_SIZE = 72; // 最大字号(px)

// 模块级复用,避免每次调用都重建分词器
const SEGMENTER = new Intl.Segmenter('zh-CN', { granularity: 'word' });

/**
 * 剥离 markdown 语法与代码噪声,只保留可读正文。
 * 否则代码块、URL、文件名里的英文 token 会淹没中文主题词。
 */
function cleanBody(text: string): string {
  let t = text;
  t = t.replace(/```[\s\S]*?```/g, ' '); // 代码块
  t = t.replace(/`[^`]*`/g, ' '); // 行内代码
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // 图片 ![alt](url)
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // 链接 [text](url) -> text
  t = t.replace(/https?:\/\/[^\s)\]<>]+/g, ' '); // 裸 URL
  t = t.replace(/<[^>]+>/g, ' '); // HTML 标签
  return t;
}

function segment(text: string): string[] {
  const out: string[] = [];
  for (const { segment: s, isWordLike } of SEGMENTER.segment(text)) {
    if (!isWordLike) continue;
    const t = s.trim().toLowerCase();
    if (!t) continue;
    // 纯数字
    if (/^\p{N}+$/u.test(t)) continue;
    // 纯标点 / 符号(注意不能用 \W:它会把中文当作非单词字符过滤掉)
    if (/^[\p{P}\p{S}]+$/u.test(t)) continue;
    // 单字 token(虚词、被拆开的双字词残留)噪声大,只保留成词
    if (t.length < 2) continue;
    // 文件名 / 域名 / 版本号等噪声(含 . / \ _ - 或过长 token)
    if (t.length > 18 || /[.\/\\_\-]/.test(t)) continue;
    out.push(t);
  }
  return out;
}

export function buildWordCloud(
  documents: { title: string; body: string }[],
  options?: { maxWords?: number; minCount?: number },
): WordCloudWord[] {
  const maxWords = options?.maxWords ?? DEFAULT_MAX_WORDS;
  const minCount = options?.minCount ?? DEFAULT_MIN_COUNT;

  const freq = new Map<string, number>();
  const bump = (t: string) => {
    if (STOPWORDS.has(t)) return;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  };

  for (const doc of documents) {
    // 标题重复计 2 次,提高主题词权重
    for (const t of segment(doc.title)) {
      bump(t);
      bump(t);
    }
    for (const t of segment(cleanBody(doc.body))) bump(t);
  }

  const words = [...freq.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxWords);

  if (words.length === 0) return [];

  // 对数缩放,压缩长尾差异,避免小词小到看不见
  const min = words[words.length - 1][1];
  const max = words[0][1];
  const span = Math.log(max) - Math.log(min) || 1;

  return words.map(([text, count]) => ({
    text,
    count,
    weight: Math.round(
      MIN_SIZE + ((MAX_SIZE - MIN_SIZE) * (Math.log(count) - Math.log(min))) / span,
    ),
  }));
}
