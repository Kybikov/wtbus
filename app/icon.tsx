import { vivatIcon } from "@/lib/vivat-icon"

export function generateImageMetadata() {
  return [64, 192, 512].map((width) => ({
    id: String(width),
    size: { width, height: width },
    contentType: "image/png",
  }))
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const width = Number(await id)
  return vivatIcon(width, width === 512)
}
