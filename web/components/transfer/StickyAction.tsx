"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A page's main action, repeated along the bottom of a phone's screen once the original has
 * scrolled away above — down a long file list, well out of a thumb's reach.
 */
export function StickyAction({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);

  useEffect(() => {
    const el = anchor.current;
    if (!enabled || !el) return;
    const observer = new IntersectionObserver(([entry]) =>
      setAbove(!entry.isIntersecting && entry.boundingClientRect.top < 0),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return (
    <>
      <div ref={anchor} className="w-full sm:w-auto">
        {children}
      </div>
      {enabled &&
        above &&
        // At the very end of the page, where the room left for the bar is below everything else.
        createPortal(
          <>
            {/* Room below the list, so the bar never covers its last rows. */}
            <div aria-hidden="true" className="h-20 sm:hidden" />
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
              {children}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
