export const MAX_MOMENT_IMAGES: number;

export interface DailyMomentImagePayload {
  src: string;
  alt?: string;
  original?: string;
}

export interface DailyMomentLinkCardPayload {
  title: string;
  url: string;
  label?: string;
  description?: string;
}

export interface DailyMomentRecord {
  id: string;
  createdAt: string;
  text: string;
  images: DailyMomentImagePayload[];
  tags?: string[];
  pinned?: boolean;
  draft?: boolean;
  location?: string;
  device?: string;
  mood?: string;
  threadId?: string;
  threadLabel?: string;
  linkCard?: DailyMomentLinkCardPayload;
}

export function pad2(n: number): string;
export function isImageFileLike(file: File): boolean;
export function toLocalDateTimeValue(iso?: string): string;
export function toShanghaiIsoOffset(localValue: string): string;
export function extractHashtagsFromText(text: string): string[];
export function createMomentId(existingItems?: DailyMomentRecord[], createdAt?: string): string;
export function sortDailyItems(items?: DailyMomentRecord[]): DailyMomentRecord[];
export function sanitizeDailyEntry(raw: Partial<DailyMomentRecord> & { tags?: string[] | string }, existingItems?: DailyMomentRecord[]): DailyMomentRecord;

export interface MomentsGridController {
  setImages(rawList?: DailyMomentImagePayload[]): void;
  addFiles(rawFiles: FileList | File[]): void;
  addExistingUrls(entries?: Array<{ src?: string; url?: string; original?: string; originalUrl?: string; alt?: string }>): void;
  openPicker(): void;
  getImages(): DailyMomentImagePayload[];
  getCount(): number;
  hasPendingUploads(): boolean;
  hasErrors(): boolean;
  waitForUploads(): Promise<boolean>;
  destroy(): void;
}

export function createMomentsPhotoGrid(options: {
  gridEl: HTMLElement;
  fileInputEl?: HTMLInputElement | null;
  maxImages?: number;
  uploadFile: (file: File, onProgress: (pct: number) => void) => Promise<{ url: string; originalUrl?: string; previewUrl?: string }>;
  resolvePreviewSrc?: (item: { src: string; previewUrl?: string }) => string;
  onChange?: () => void;
  onToast?: (msg: string) => void;
  onPreview?: ((item: { src: string; alt: string; previewUrl?: string }, idx: number, items: unknown[], sync: () => void) => void) | null;
}): MomentsGridController;
