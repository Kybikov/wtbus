import { BellRing } from "lucide-react"
export function ProviderLogo({
  provider,
}: {
  provider: "telegram" | "push" | "monobank"
}) {
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-xl bg-control"
    >
      {provider === "telegram" ? (
        <svg viewBox="0 0 24 24" className="size-7">
          <circle cx="12" cy="12" r="12" fill="#229ED9" />
          <path
            d="m5 11.7 13-5c.6-.2 1 .1.8 1l-2.2 10.2c-.2.7-.7.9-1.2.5l-3.3-2.5-1.6 1.6c-.2.2-.3.3-.6.3l.2-3.4 6.1-5.5c.3-.2 0-.4-.4-.2l-7.5 4.7-3.2-1c-.7-.2-.7-.6-.1-.8Z"
            fill="white"
          />
        </svg>
      ) : provider === "push" ? (
        <BellRing className="size-5 text-primary" />
      ) : (
        <span className="text-xl font-bold">m</span>
      )}
    </span>
  )
}
