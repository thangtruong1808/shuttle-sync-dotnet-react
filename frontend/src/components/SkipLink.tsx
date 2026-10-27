export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-fg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent-text"
    >
      Skip to content
    </a>
  );
}
