import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ open, title, onClose, children, footer }: { open:boolean; title:string; onClose:()=>void; children:ReactNode; footer?:ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
    <button aria-label="Cerrar" className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
    <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col animate-scale-in">
      <div className="flex items-center justify-between px-5 py-4 border-b border-line"><h2 className="text-lg font-bold">{title}</h2><button className="p-2 rounded-lg hover:bg-surface-alt" onClick={onClose}><X size={20}/></button></div>
      <div className="p-5 overflow-y-auto flex-1">{children}</div>
      {footer ? <div className="px-5 py-4 border-t border-line flex gap-3">{footer}</div> : null}
    </div>
  </div>;
}
