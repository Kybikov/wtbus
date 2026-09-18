import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PublicBooking } from "@/components/public-booking"
import { publicTenantPattern } from "@/lib/public-booking"

export const metadata: Metadata = { title: "Квитки на автобус — Vivat Bus", description: "Знайдіть свій рейс і забронюйте місця з оплатою при посадці." }

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!publicTenantPattern.test(slug)) notFound()
  return <PublicBooking slug={slug} />
}
