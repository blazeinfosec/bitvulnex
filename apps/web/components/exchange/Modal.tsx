"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** When true, clicking the backdrop will NOT close the modal. */
  disableBackdropClose?: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hand-rolled modal shell — no dialog dep (we only have @radix-ui/react-slot).
 * Renders into a portal on document.body for proper z-index isolation.
 * - Backdrop click + ESC closes
 * - Body scroll locked while open
 * - Focus moves to first focusable element on open, restores on close
 * - Tab / Shift+Tab cycle focus within the modal
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  disableBackdropClose,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus first focusable element in modal
    const focusables = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusables?.[0];
    if (first) first.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const items = cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) {
        // Nothing to focus inside; keep focus on the card itself.
        e.preventDefault();
        cardRef.current.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // If focus has somehow escaped the modal, snap it back.
      if (!cardRef.current.contains(active)) {
        e.preventDefault();
        firstItem.focus();
        return;
      }
      if (e.shiftKey && active === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    window.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKey);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close modal"
        tabIndex={-1}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
        onClick={() => {
          if (!disableBackdropClose) onClose();
        }}
      />
      {/* Card */}
      <div
        ref={cardRef}
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-md rounded-lg border border-border bg-bg-elevated shadow-elevated",
          "max-h-[90vh] overflow-y-auto",
          "focus:outline-none",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="text-sm text-text-dim mt-1">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-mute hover:text-text transition-colors -mt-1 -mr-1 p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer ? (
          <div className="p-5 pt-0 flex items-center justify-end gap-2 border-t border-border-subtle mt-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
