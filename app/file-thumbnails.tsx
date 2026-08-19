"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { createFileThumbnail } from "../lib/file-thumbnail.mjs";

export type ThumbnailItem = { id: string; file: File; caption: string };

/**
 * Shows what was actually uploaded.
 *
 * Filenames alone do not reveal a scan of the wrong side, or of somebody else's
 * card, and by the time the mistake surfaces the generated paperwork already
 * carries the wrong name.
 */
export default function FileThumbnails({
  items,
  emptyHint,
}: {
  items: ThumbnailItem[];
  emptyHint: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const revokers: (() => void)[] = [];
    void (async () => {
      for (const item of items) {
        const thumbnail = await createFileThumbnail(item.file);
        revokers.push(thumbnail.revoke);
        if (cancelled) {
          thumbnail.revoke();
          return;
        }
        setUrls((current) => ({ ...current, [item.id]: thumbnail.url }));
      }
    })();
    return () => {
      cancelled = true;
      for (const revoke of revokers) revoke();
    };
    // Rebuilding on the id list keeps one thumbnail per uploaded file without
    // re-rasterising every PDF whenever an unrelated part of the form changes.
  }, [items.map((item) => item.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length)
    return <p className="thumbnail-empty">{emptyHint}</p>;

  return (
    <div className="thumbnail-strip">
      {items.map((item) => (
        <figure key={item.id}>
          {urls[item.id] ? (
            <img src={urls[item.id]} alt={`${item.caption}預覽`} />
          ) : (
            <span className="thumbnail-blank">
              <ImageOff size={18} />
            </span>
          )}
          <figcaption>
            <strong>{item.caption}</strong>
            <small>{item.file.name}</small>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
