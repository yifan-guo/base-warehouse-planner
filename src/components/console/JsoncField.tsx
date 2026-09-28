import { useRef } from "react";
import { toggleLineComment } from "@/lib/sim/jsonc";

export function JsoncField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <label className="mt-2 block">
      <span className="font-mono text-xs tracking-widest text-muted">{label}</span>
      <span className="mt-1 block text-xs text-muted">{hint}</span>
      <textarea
        ref={ref}
        value={value}
        spellCheck={false}
        className="mt-1 h-36 w-full resize-y bg-ink p-2 font-mono text-xs leading-5 text-paper outline-none"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "/") {
            e.preventDefault();
            const el = ref.current;
            if (!el) return;
            const next = toggleLineComment(value, el.selectionStart, el.selectionEnd);
            onChange(next.text);
            requestAnimationFrame(() => {
              el.focus();
              el.setSelectionRange(next.start, next.end);
            });
          }
        }}
      />
    </label>
  );
}
