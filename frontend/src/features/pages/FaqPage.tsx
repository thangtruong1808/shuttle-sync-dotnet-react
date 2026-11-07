import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { PageSection } from "../../components/layout/SiteLayout";
import { PageHeader } from "../../components/ui";

const items: { question: string; answer: ReactNode }[] = [
  {
    question: "How do I see which courts are free?",
    answer: "Choose a day on the venue home page. A court with no bookings listed is available. Booked times appear on that court. You can also narrow the day with From and To.",
  },
  {
    question: "How do I book a court?",
    answer: "Sign in, choose Book a court, then pick one or more courts, the date, and the time. You can repeat that time for up to 12 weeks. There is no deposit, and you do not pay every week today. Each week is paid on its own, any time before 24 hours of that session. If a week is still unpaid then, those courts are released. A session that starts within 24 hours has to be paid straight away. One promotion code and your reward points apply to the week you are paying.",
  },
  {
    question: "What is a public social?",
    answer: "A public social is a drop-in session. You pay for a place, and the venue assigns courts in order. Court 1 fills first, up to the players per court and the court limit set for that session. The next person uses another court only after the earlier court is full.",
  },
  {
    question: "What if the social is full?",
    answer: "Join the waitlist from Register for public social. You pay first, the same way as a normal place. If someone leaves before the session starts, the first person waiting gets the place. If the session starts while you are still waiting, that payment and any points you used are refunded in full.",
  },
  {
    question: "Can I bring friends?",
    answer: "After your own place is confirmed, use Add friends. You pay for the friends only, not for your place again. Each friend can earn the venue's incentive after the social ends. Their names stay in Friend spots even if you later cancel your own place.",
  },
  {
    question: "Where do I see who is registered?",
    answer: "On the venue home page, View registration on a court shows the display names on that court. On Register for public social, View registration shows everyone in that session. In My bookings, View registration shows your place and your friends.",
  },
  {
    question: "When do reward points arrive?",
    answer: "Points you can spend are available now. Points from a court, public social, or friend are pending until that session ends, then they move to your balance. Open Reward points in your profile to see both. A cancelled place does not earn them.",
  },
  {
    question: "How do refunds work?",
    answer: (
      <>
        Cancel before the session starts. More than 24 hours before the start, the card payment and the points you used come back in full. Within 24 hours, the venue keeps its late-cancel percent of the charge. Points used on a court booking still come back in full. For a public social or friend, the venue keeps the same percent of the points used. See the <Link to="/cancellation" className="font-semibold text-accent-text hover:underline">cancellation policy</Link>.
      </>
    ),
  },
];

export function FaqPage() {
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  function move(current: HTMLButtonElement, key: string) {
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const buttons = current.closest("[data-accordion]")?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons?.length) return;
    const list = [...buttons];
    const index = list.indexOf(current);
    const next = key === "Home" ? 0 : key === "End" ? list.length - 1 : key === "ArrowDown" ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  return (
    <main>
      <PageSection>
        <PageHeader title="FAQ" description="Short answers for finding a court, joining a public social, and using reward points. Open a question to read more." />
        <div data-accordion className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card dark:shadow-none">
          {items.map((item, index) => {
            const expanded = open.has(index);
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-button-${index}`;
            return (
              <div key={item.question}>
                <h2>
                  <button
                    id={buttonId}
                    type="button"
                    className="flex min-h-11 w-full items-start justify-between gap-3 px-4 py-3.5 text-left text-base font-medium text-fg transition hover:bg-surface-2 sm:gap-4 sm:px-5 sm:py-4"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpen((current) => {
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        move(event.currentTarget, event.key);
                      }
                    }}
                  >
                    <span className="min-w-0 break-words">{item.question}</span>
                    <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-accent-text transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                </h2>
                <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded} className="break-words px-4 pb-4 text-sm leading-relaxed text-fg/80 sm:px-5">
                  {item.answer}
                </div>
              </div>
            );
          })}
        </div>
      </PageSection>
    </main>
  );
}
