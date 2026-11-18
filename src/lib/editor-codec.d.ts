export function escapeHtml(value: unknown): string;
export function escapeAttr(value: unknown): string;
export function unescapeHtml(value: unknown): string;
export function safeUrl(raw: unknown): string;
export function normalizeLegacyMarkdown(markdown: string): string;
export function markdownToEditorHtml(markdown: string): string;
export function serializeDocToMarkdown(docJson: unknown): string;
export function extractOutlineFromDoc(docJson: unknown): Array<{ index: number; level: number; text: string }>;
export function countMarkdownStats(md: string): {
  chars: number;
  images: number;
  missingAlt: number;
  links: number;
  minutes: number;
};
