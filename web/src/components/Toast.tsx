"use client";

import { useState, useEffect, createContext, useContext, useCallback } from "react";

interface ToastMsg {
  id: number;
  text: string;
  type: "success" | "info" | "error";
}

const ToastCtx = createContext<(text: string, type?: "success" | "info" | "error") => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  let counter = 0;

  const show = useCallback((text: string, type: "success" | "info" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2500);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl px-5 py-3 text-sm font-medium backdrop-blur-md shadow-2xl animate-[slideUp_0.3s_ease-out] ${
              t.type === "success" ? "bg-[var(--gold)]/90 text-black" :
              t.type === "error" ? "bg-[var(--red)]/90 text-white" :
              "bg-[var(--bg-elevated)]/90 text-[var(--text-primary)] border border-[var(--border-gold)]"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
