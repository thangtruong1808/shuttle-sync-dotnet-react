import { useEffect } from "react";

const REVEAL_SELECTOR =
  ".reveal-up, .reveal-down, .reveal-left, .reveal-right, .reveal-scale, .reveal-stagger > *";

/**
 * Bidirectional scroll-reveal hook.
 * - Observes elements entering and leaving the viewport in BOTH scroll directions
 *   (scrolling DOWN and scrolling UP).
 * - Accounts for the sticky 64px top navbar and bottom viewport margin so animations
 *   trigger clearly inside the visible screen area rather than off-screen.
 * - Automatically observes dynamically rendered elements (courts, rates, promos).
 */
export function useScrollReveal(dependencies: readonly unknown[] = []): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.classList.add("js-scroll-reveal");

    // Assign --stagger-index per visual row so multi-row grids cascade cleanly
    const stampStaggerChildren = () => {
      const staggerContainers = document.querySelectorAll<HTMLElement>(".reveal-stagger");
      staggerContainers.forEach((container) => {
        const children = Array.from(container.children).filter(
          (child): child is HTMLElement => child instanceof HTMLElement,
        );
        let rowIndex = 0;
        let lastTop: number | null = null;
        children.forEach((child, idx) => {
          const top = child.offsetTop;
          if (lastTop !== null && Math.abs(top - lastTop) > 16) {
            rowIndex = 0;
          } else if (idx > 0) {
            rowIndex += 1;
          }
          lastTop = top;
          child.style.setProperty("--stagger-index", String(rowIndex));
        });
      });
    };

    stampStaggerChildren();

    const applyEntryState = (
      target: HTMLElement,
      isIntersecting: boolean,
      ratio: number,
      rect: DOMRectReadOnly,
    ) => {
      const viewportHeight = window.innerHeight || root.clientHeight || 800;
      // For tall elements (>420px), require a smaller fraction of the element height
      const minRatio =
        rect.height > 420
          ? Math.min(0.14, Math.max(0.05, (viewportHeight * 0.14) / rect.height))
          : 0.14;

      if (isIntersecting && ratio >= minRatio) {
        target.classList.add("is-in-view");
        target.classList.remove("is-above-view");
      } else {
        target.classList.remove("is-in-view");
        const elementCenter = rect.top + rect.height * 0.5;
        if (rect.top < viewportHeight * 0.35 && elementCenter < viewportHeight * 0.5) {
          target.classList.add("is-above-view");
        } else {
          target.classList.remove("is-above-view");
        }
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          applyEntryState(
            target,
            entry.isIntersecting,
            entry.intersectionRatio,
            entry.boundingClientRect,
          );
        }
      },
      {
        root: null,
        // Top -84px clears the 64px sticky navbar; bottom -10% triggers while clearly in view
        rootMargin: "-84px 0px -10% 0px",
        threshold: [0, 0.06, 0.14, 0.25, 0.5],
      },
    );

    const observed = new WeakSet<Element>();
    const observeAll = () => {
      stampStaggerChildren();
      const elements = document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR);
      elements.forEach((el) => {
        if (!observed.has(el)) {
          observed.add(el);
          observer.observe(el);
        }
      });
    };

    observeAll();

    const mutationObserver = new MutationObserver(() => {
      observeAll();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Fallback for top scroll progress bar when animation-timeline: scroll() is unsupported
    const supportsScrollTimeline =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("animation-timeline", "scroll()");

    let rafId = 0;
    const updateScrollProgress = () => {
      rafId = 0;
      const scrollTop = window.scrollY || root.scrollTop;
      const maxScroll = Math.max(1, root.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, scrollTop / maxScroll));
      root.style.setProperty("--scroll-progress", progress.toFixed(4));
    };

    const onScroll = () => {
      if (rafId === 0) {
        rafId = window.requestAnimationFrame(updateScrollProgress);
      }
    };

    const onResize = () => {
      stampStaggerChildren();
      if (!supportsScrollTimeline) {
        onScroll();
      }
    };

    if (!supportsScrollTimeline) {
      updateScrollProgress();
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}
