import { useEffect } from "react";
import { Button } from "../../components/ui";

export function ConfirmTimeDialog({
  title,
  detail,
  error,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  error?: string | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-time-title" className="w-full max-w-md rounded-2xl border border-white/15 bg-[#102117] p-4 shadow-xl">
        <h2 id="confirm-time-title" className="text-base font-semibold text-white">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-mist/80">{detail}</p>
        {error ? <p className="mt-3 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium text-rose-100" role="alert">{error}</p> : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="w-full sm:flex-1" loading={loading} disabled={loading} onClick={onConfirm}>Confirm new time</Button>
          <Button type="button" variant="secondary" className="w-full sm:flex-1" disabled={loading} onClick={onCancel}>Keep current time</Button>
        </div>
      </div>
    </div>
  );
}
