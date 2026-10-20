"use client"
import * as React from "react"
import { Eye, Settings2, Trash2 } from "lucide-react"
import SwipeRow from "@/components/react-bits/micro/SwipeRow/SwipeRow"
import { useIsMobile } from "@/hooks/use-mobile"

export function MobileSwipeActions({
  children,
  label,
  onOpen,
  actions = [],
}: {
  children: React.ReactNode
  label: string
  onOpen?: () => void
  actions?: { label: string; destructive?: boolean; onSelect: () => void }[]
}) {
  const mobile = useIsMobile(),
    content = React.useRef<HTMLDivElement>(null)
  const [height, setHeight] = React.useState(160)
  React.useLayoutEffect(() => {
    if (!mobile || !content.current) return
    const element = content.current
    const observer = new ResizeObserver(() =>
      setHeight(Math.ceil(element.getBoundingClientRect().height))
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [mobile])
  if (!mobile) return children
  const choices = [
    ...(onOpen
      ? [
          {
            id: "open",
            label: "Открыть",
            color: "var(--control-hover)",
            icon: <Eye className="size-5" />,
            callback: onOpen,
          },
        ]
      : []),
    ...actions.slice(0, 2).map((action, index) => ({
      id: String(index),
      label: action.label,
      icon: action.destructive ? (
        <Trash2 className="size-5" />
      ) : (
        <Settings2 className="size-5" />
      ),
      color: action.destructive ? "var(--destructive)" : "var(--control-hover)",
      callback: action.onSelect,
    })),
  ]
  if (!choices.length) return children
  return (
    <SwipeRow
      actions={choices}
      label={label}
      height={height}
      radius={16}
      fullSwipe={false}
      actionColor={choices[0].color ?? "var(--control-hover)"}
      drawerColor="var(--control-hover)"
      rowColor="var(--card)"
      textColor="var(--foreground)"
      surfaceClassName="!block !p-0"
      onAction={(action) =>
        choices.find((choice) => choice.id === action.id)?.callback()
      }
      onSurfaceTap={onOpen}
    >
      <div ref={content} className="w-full min-w-0">
        {children}
      </div>
    </SwipeRow>
  )
}
