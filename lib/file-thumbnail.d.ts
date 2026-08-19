export function createFileThumbnail(file: File): Promise<{ url: string; revoke: () => void }>;
