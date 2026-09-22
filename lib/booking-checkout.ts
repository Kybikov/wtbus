import { isValidPhoneNumber } from "react-phone-number-input"
import type { PublicField } from "./public-booking"

export type CheckoutPassenger = { firstName: string; lastName: string; birthDate: string }
export type CheckoutErrors = Record<string, string>
export const latinPassengerName = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/

export function validateCheckout({ passengers, seats, phone, paymentMethod, fields, custom, today }: {
  passengers: CheckoutPassenger[]; seats: number; phone: string; paymentMethod: string
  fields: PublicField[]; custom: Record<string, string | number | boolean>; today: string
}): CheckoutErrors {
  const errors: CheckoutErrors = {}
  passengers.forEach((person, index) => {
    for (const key of ["firstName", "lastName"] as const) {
      const name = person[key].trim()
      if (!name) errors[`passenger-${index}-${key}`] = key === "firstName" ? "Вкажіть ім’я." : "Вкажіть прізвище."
      else if (name.length > 80 || !latinPassengerName.test(name) || `${person.firstName.trim()} ${person.lastName.trim()}`.length > 160) errors[`passenger-${index}-${key}`] = "Латинські літери, як у документі. Можна пробіл, дефіс та апостроф."
    }
    const birth = new Date(`${person.birthDate}T00:00:00Z`)
    const oldest = new Date(`${today}T00:00:00Z`)
    oldest.setUTCFullYear(oldest.getUTCFullYear() - 125)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(person.birthDate) || !Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== person.birthDate || person.birthDate > today || birth < oldest) errors[`passenger-${index}-birthDate`] = "Оберіть правильну дату народження."
  })
  if (passengers.length !== seats) errors.passengers = `Додайте дані всіх пасажирів: ${passengers.length} із ${seats}.`
  if (!phone || !isValidPhoneNumber(phone)) errors["passenger-phone"] = "Вкажіть правильний номер із кодом країни."
  if (!["cash_on_boarding", "bank_transfer"].includes(paymentMethod)) errors["payment-method"] = "Оберіть спосіб оплати."
  fields.forEach((field) => {
    const value = custom[field.key]
    if (value === undefined || value === "" || (typeof value === "string" && !value.trim())) errors[`booking-${field.key}`] = "Заповніть це поле."
    else if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) errors[`booking-${field.key}`] = "Вкажіть правильне число."
    else if (field.type === "select" && !field.options.includes(String(value))) errors[`booking-${field.key}`] = "Оберіть доступне значення."
    else if (field.type === "date") {
      const date = new Date(`${value}T00:00:00Z`)
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) errors[`booking-${field.key}`] = "Оберіть правильну дату."
    }
  })
  return errors
}

export function bookingPassengers(data?: Record<string, unknown>): CheckoutPassenger[] {
  return Array.isArray(data?.passengers) ? data.passengers.filter((person): person is CheckoutPassenger => !!person && typeof person === "object" && typeof person.firstName === "string" && typeof person.lastName === "string" && typeof person.birthDate === "string") : []
}
