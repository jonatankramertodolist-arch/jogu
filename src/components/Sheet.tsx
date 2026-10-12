import type { ReactNode } from 'react';
import { useEffect } from 'react';

export default function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    // Stops the page behind the sheet from scrolling on iOS.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Stäng"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="safe-bottom relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-base-700 bg-base-900 px-4 pt-3">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-base-600" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[19px] font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-base-800 px-3 py-1.5 text-[13px] text-muted"
          >
            Stäng
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
