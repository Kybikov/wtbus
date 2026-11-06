import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PublicBooking } from "@/components/public-booking"
import { publicTenantPattern } from "@/lib/public-booking"

const title = "Трансфер — Vivat Bus"
const description =
  "Знайдіть свій трансфер і забронюйте місця з оплатою при посадці."
export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description },
  twitter: { card: "summary", title, description },
}

export default async function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!publicTenantPattern.test(slug)) notFound()
  return <PublicBooking slug={slug} />
}
