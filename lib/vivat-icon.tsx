import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"

export async function vivatIcon(width: number, maskable = false) {
  const logo = await readFile(join(process.cwd(), "public/brand/vivat-bus.png"))
  const scale = (width / 64) * (maskable ? 0.8 : 1)
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width,
        height: width,
        background: "black",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "relative",
          width: 56 * scale,
          height: 34 * scale,
          overflow: "hidden",
        }}
      >
        {/* Original VB mark, without lettering that is unreadable at icon size. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src={`data:image/jpeg;base64,${logo.toString("base64")}`}
          width={143.36 * scale}
          height={143.36 * scale}
          style={{
            position: "absolute",
            width: 143.36 * scale,
            height: 143.36 * scale,
            left: -43.008 * scale,
            top: -43.008 * scale,
          }}
        />
      </div>
    </div>,
    { width, height: width }
  )
}
