"use client"

import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react"
export interface SquishSwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (checked: boolean) => void
  label?: string
  disabled?: boolean
  trackColor?: string
  trackOnColor?: string
  thumbColor?: string
  thumbOnColor?: string
  width?: number
  height?: number
  radius?: number
  speed?: number
  stretch?: number
  hoverScale?: number
  colorDuration?: number
  ariaLabel?: string
  className?: string
  id?: string
}

interface Grip {
  id: number
  grab: number | null
  moved: boolean
  startX: number
  onAtPress: boolean
  slop: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const FLOW_SPRING = { stiffness: 320, damping: 40, mass: 0.6 }
const SWELL_SPRING = { stiffness: 520, damping: 34, mass: 0.6 }
const MAX_STRETCH = 0.4
const STRETCH_SPEED = 600
const TAP_SLOP = { fine: 4, coarse: 8 }

const SquishSwitch: React.FC<SquishSwitchProps> = ({
  checked,
  defaultChecked = false,
  onChange,
  label = "",
  disabled = false,
  trackColor = "#27272a",
  trackOnColor = "#f5f5f5",
  thumbColor = "",
  thumbOnColor = "",
  width = 76,
  height = 38,
  radius = 19,
  speed = 50,
  stretch = 36,
  hoverScale = 1.035,
  colorDuration = 320,
  ariaLabel,
  className = "",
  id,
}) => {
  const reduce = useReducedMotion()
  const inset = Math.max(3, Math.round(height * 0.11))
  const thumb = height - inset * 2
  const min = inset
  const max = width - inset - thumb
  const mid = (min + max) / 2
  const trackRadius = Math.min(radius, height / 2)
  const thumbRadius = Math.max(2, trackRadius - inset)

  const isControlled = checked !== undefined
  const [inner, setInner] = useState(defaultChecked)
  const on = isControlled ? checked : inner
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLSpanElement>(null)
  const grip = useRef<Grip | null>(null)
  const onRef = useRef(on)
  useLayoutEffect(() => {
    onRef.current = on
  }, [on])
  const skipClick = useRef(false)
  const autoId = useId()
  const buttonId = id ?? autoId

  const x = useMotionValue(on ? max : min)
  const flow = useSpring(useVelocity(x), FLOW_SPRING)
  const swell = useSpring(1, SWELL_SPRING)
  const gain = reduce ? 0 : clamp(stretch, 0, 100) / 100
  const stretchOf = (v: number) =>
    1 + Math.min(MAX_STRETCH, Math.abs(v) / STRETCH_SPEED) * gain
  const scaleX = useTransform(
    [flow, swell],
    ([v, h]: number[]) => stretchOf(v) * h
  )
  const scaleY = useTransform(
    [flow, swell],
    ([v, h]: number[]) => h / stretchOf(v)
  )

  const commit = (next: boolean) => {
    if (disabled || next === onRef.current) return
    onRef.current = next
    if (!isControlled) setInner(next)
    onChange?.(next)
  }

  useEffect(() => {
    if (dragging) return undefined
    const target = on ? max : min
    if (reduce) {
      x.jump(target)
      return undefined
    }
    const controls = animate(x, target, {
      type: "spring",
      stiffness: 170 - (50 - clamp(speed, 0, 100)) * 1.1,
      damping: 21.5,
      mass: 0.9,
      restDelta: 0.001,
      restSpeed: 0.01,
    })
    return () => controls.stop()
  }, [on, dragging, min, max, speed, reduce, x])

  const localX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const scale = rect.width / (el.offsetWidth || rect.width) || 1
    return (clientX - rect.left) / scale
  }
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || grip.current || e.button !== 0) return
    skipClick.current = false
    grip.current = {
      id: e.pointerId,
      grab: null,
      moved: false,
      startX: e.clientX,
      onAtPress: onRef.current,
      slop: e.pointerType === "touch" ? TAP_SLOP.coarse : TAP_SLOP.fine,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    setDragging(true)
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const g = grip.current
    if (!g || g.id !== e.pointerId) return
    const lx = localX(e.clientX)
    if (g.grab === null) {
      g.grab = lx - x.get()
      return
    }
    if (!g.moved && Math.abs(e.clientX - g.startX) > g.slop) g.moved = true
    if (!g.moved) return
    const nx = clamp(lx - g.grab, min, max)
    x.set(nx)
  }
  const up = (
    e: { pointerId: number; currentTarget: HTMLButtonElement },
    cancelled: boolean
  ) => {
    const g = grip.current
    if (!g || g.id !== e.pointerId) return
    grip.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
    if (!cancelled) commit(g.moved ? x.get() > mid : !onRef.current)
    skipClick.current = true

    setDragging(false)
  }
  const click = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (skipClick.current && event.detail !== 0) {
      skipClick.current = false
      return
    }
    skipClick.current = false
    if (!disabled) commit(!onRef.current)
  }

  return (
    <span
      className={`inline-flex items-center gap-2.5${className ? ` ${className}` : ""}`}
    >
      <button
        id={buttonId}
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        data-slot="switch"
        aria-disabled={disabled || undefined}
        aria-label={ariaLabel}
        className="group relative m-0 inline-grid cursor-pointer touch-pan-y place-items-center border-0 bg-transparent p-0 outline-none select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] after:absolute after:-inset-2 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[held]:cursor-grabbing"
        data-on={on ? "" : undefined}
        data-held={dragging ? "" : undefined}
        style={
          {
            "--ss-w": `${width}px`,
            "--ss-h": `${height}px`,
            "--ss-inset": `${inset}px`,
            "--ss-thumb": `${thumb}px`,
            "--ss-r": `${trackRadius}px`,
            "--ss-thumb-r": `${thumbRadius}px`,
            "--ss-track": trackColor,
            "--ss-track-on": trackOnColor,
            "--ss-thumb-color":
              thumbColor ||
              `color-mix(in srgb, ${trackOnColor} 19%, ${trackColor})`,
            "--ss-thumb-on": thumbOnColor || trackColor,
            "--ss-fade": `${colorDuration}ms`,
          } as CSSProperties
        }
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => up(e, false)}
        onPointerCancel={(e) => up(e, true)}
        onLostPointerCapture={(e) => up(e, true)}
        onPointerEnter={(e: PointerEvent<HTMLButtonElement>) => {
          if (e.pointerType === "mouse" && !disabled) swell.set(hoverScale)
        }}
        onPointerLeave={() => swell.set(1)}
        onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
          if (e.key === "Escape" && grip.current)
            up(
              { pointerId: grip.current.id, currentTarget: e.currentTarget },
              true
            )
        }}
        onClick={click}
      >
        <span
          ref={trackRef}
          className="relative block [height:var(--ss-h)] [width:var(--ss-w)] [border-radius:var(--ss-r)] [background:var(--ss-track)] [transition:background-color_var(--ss-fade)_ease] group-data-[on]:[background:var(--ss-track-on)] motion-reduce:[transition-duration:1ms]"
        >
          <motion.span
            className="absolute [top:var(--ss-inset)] left-0 [height:var(--ss-thumb)] [width:var(--ss-thumb)] [border-radius:var(--ss-thumb-r)] [background:var(--ss-thumb-color)] [transition:background-color_var(--ss-fade)_ease] group-data-[on]:[background:var(--ss-thumb-on)] motion-reduce:[transition-duration:1ms]"
            aria-hidden="true"
            style={{ x, scaleX, scaleY }}
          />
        </span>
      </button>
      {label ? (
        <label htmlFor={buttonId} className="cursor-pointer select-none">
          {label}
        </label>
      ) : null}
    </span>
  )
}

export default SquishSwitch
