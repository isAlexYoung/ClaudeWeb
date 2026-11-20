import type { ProjectUploadedFile } from '@/shared/types';

/** "PDF", "PNG", … from the name; the MIME type when the name has no extension. */
export function fileTypeLabel(file: Pick<ProjectUploadedFile, 'name' | 'mimeType'>): string {
  const extension = /\.([A-Za-z0-9]{1,10})$/.exec(file.name)?.[1];
  if (extension) return extension.toUpperCase();
  return file.mimeType || '—';
}
