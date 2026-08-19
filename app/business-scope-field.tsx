"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  findBusinessItem,
  formatBusinessItem,
  parseBusinessItem,
  searchBusinessItems,
} from "../lib/business-scope.mjs";

const MAX_SUGGESTIONS = 12;

/**
 * One 所營事業 row: sequence badge, code, description and delete control.
 *
 * The official catalogue holds 788 items, far too many for a plain select, so
 * the description cell is a combo box that matches on either the code or the
 * Chinese label. Free text is still accepted because pre-check OCR sometimes
 * returns an item this build's snapshot does not know.
 */
export default function BusinessScopeField({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
  onRemove: () => void;
}) {
  const parsed = useMemo(() => parseBusinessItem(value), [value]);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const listId = `business-options-${index}`;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const open = query !== null;
  const suggestions = useMemo(
    () => (open ? searchBusinessItems(query ?? "", MAX_SUGGESTIONS) : []),
    [open, query],
  );

  const commit = (item: { code: string; name: string }) => {
    onChange(formatBusinessItem(item));
    setQuery(null);
  };
  /**
   * Closes the list, keeping whatever was typed.
   *
   * Text that matched nothing is still meaningful — the pre-check certificate
   * can list an item this build's catalogue snapshot does not have — so leaving
   * the field must never silently discard it.
   */
  const dismiss = () => {
    if (query !== null && query !== parsed.name)
      onChange(formatBusinessItem({ code: parsed.code, name: query }));
    setQuery(null);
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      if (query !== null && query !== parsed.name)
        onChange(formatBusinessItem({ code: parsed.code, name: query }));
      setQuery(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, query, parsed.code, parsed.name, onChange]);

  if (confirming)
    return (
      <div className="business-confirm">
        <span>{index + 1}</span>
        <p>
          確定要刪除「{value || "空白項目"}」嗎？刪除後所營事業將與名稱預查核定書不一致。
        </p>
        <button
          className="secondary small danger"
          onClick={() => {
            setConfirming(false);
            onRemove();
          }}
        >
          確認刪除
        </button>
        <button
          className="secondary small"
          onClick={() => setConfirming(false)}
        >
          取消
        </button>
      </div>
    );

  return (
    <div ref={containerRef}>
      <span>{index + 1}</span>
      <input
        className="business-code"
        aria-label={`第 ${index + 1} 項營業項目代碼`}
        value={parsed.code}
        placeholder="代碼"
        onChange={(event) => {
          const code = event.target.value.toUpperCase();
          const known = findBusinessItem(code);
          onChange(
            formatBusinessItem({
              code,
              name: known ? known.name : parsed.name,
            }),
          );
        }}
      />
      <div className="business-combo">
        <input
          aria-label={`第 ${index + 1} 項營業項目`}
          aria-expanded={open}
          aria-controls={listId}
          role="combobox"
          autoComplete="off"
          placeholder="輸入代碼或名稱搜尋，例如 E801010 或 室內裝潢"
          value={open ? (query ?? "") : parsed.name}
          onFocus={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((current) =>
                Math.min(current + 1, suggestions.length - 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const picked = suggestions[highlight];
              if (picked) commit(picked);
              else commit({ code: parsed.code, name: query ?? "" });
            } else if (event.key === "Escape") {
              // Escape is the explicit "forget what I typed" gesture.
              setQuery(null);
            }
          }}
          onBlur={() => dismiss()}
        />
        {open && suggestions.length > 0 && (
          <ul className="business-options" id={listId} role="listbox">
            {suggestions.map((item, position) => (
              <li
                key={item.code}
                role="option"
                aria-selected={position === highlight}
                className={position === highlight ? "highlighted" : ""}
                onMouseEnter={() => setHighlight(position)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(item);
                }}
              >
                <strong>{item.code}</strong>
                <span>{item.name}</span>
                <small>{item.categoryName}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        aria-label={`刪除第 ${index + 1} 項營業項目`}
        onClick={() => setConfirming(true)}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
