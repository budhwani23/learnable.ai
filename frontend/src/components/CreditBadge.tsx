import { Coins } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { ResourceType } from "@/lib/types";

/** Corner badge on a generator tab: remaining credits for that resource type. Parent must be `relative`. */
export function CreditPill({ type }: { type: ResourceType }) {
  const { user } = useAuth();
  const c = user?.credits?.[type];
  if (!c) return null;
  if (c.unlimited) {
    return (
      <span
        data-testid={`credit-pill-${type}`}
        title="Unlimited credits (admin)"
        aria-label="Unlimited credits"
        className="pointer-events-none absolute -right-1 -top-1.5 z-10 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-1 ring-white"
      >
        ∞
      </span>
    );
  }
  return (
    <span
      data-testid={`credit-pill-${type}`}
      title={`${c.remaining} of ${c.limit} credits left`}
      aria-label={`${c.remaining} credits left`}
      className={[
        "pointer-events-none absolute -right-1 -top-1.5 z-10 inline-flex h-4 min-w-[1rem] items-center justify-center",
        "rounded-full px-1 text-[10px] font-bold leading-none shadow-sm ring-1 ring-white",
        c.remaining === 0 ? "bg-red-500 text-white" : "bg-amber-400 text-emerald-950",
      ].join(" ")}
    >
      {c.remaining}
    </span>
  );
}

/** Line under a generate button: "2 of 3 credits left · uses 1 credit", or an out-of-credits notice. */
export function CreditNote({ type }: { type: ResourceType }) {
  const { user } = useAuth();
  const c = user?.credits?.[type];
  if (!c) return null;
  if (c.unlimited) {
    return (
      <p className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground" data-testid={`credit-note-${type}`}>
        <Coins className="h-3.5 w-3.5 text-emerald-500" />
        Unlimited credits (admin)
      </p>
    );
  }
  if (c.remaining === 0) {
    return (
      <p className="mt-2 text-sm text-red-600" data-testid={`credit-note-${type}`}>
        You've used all {c.limit} credits for this. Ask an administrator for more.
      </p>
    );
  }
  return (
    <p className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground" data-testid={`credit-note-${type}`}>
      <Coins className="h-3.5 w-3.5 text-amber-500" />
      {c.remaining} of {c.limit} credits left · uses 1 credit
    </p>
  );
}
