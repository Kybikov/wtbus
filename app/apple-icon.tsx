import { vivatIcon } from "@/lib/vivat-icon"
export const size = { width: 180, height: 180 }
export const contentType = "image/png"
export default async function Icon() {
  return vivatIcon(size.width, true)
}
