import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({
    base: './src/content/blog',
    pattern: [
      '**/*.{md,mdx}',
      '!_templates/**',
      '!**/.obsidian/**',
    ],
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    cover: z.string().optional(),
    // 同一天内的发表顺序，1 = 当天第一篇；缺省时按文件名顺序兜底
    dayIndex: z.number().int().min(1).optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
