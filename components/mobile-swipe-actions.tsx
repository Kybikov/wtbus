"use client"
import * as React from "react"
import { ArrowUpRight, Trash2 } from "lucide-react"
import SwipeRow from "@/components/react-bits/micro/SwipeRow/SwipeRow"
import { useIsMobile } from "@/hooks/use-mobile"

export const mobileRecordRadius = 26

export function MobileSwipeActions({
  children,
  label,
  onOpen,
  onDelete,
  onHold,
  onTap,
}: {
  children: React.ReactNode
  label: string
  onOpen?: () => void
  onDelete?: () => void
  onHold?: () => void
  onTap?: () => void
}) {
  const mobile = useIsMobile()
  if (!mobile) return children
  return (
    <SwipeRow
      actions={
        onDelete
          ? [
              {
                id: "delete",
                label: "Удалить",
                color: "var(--destructive)",
                icon: <Trash2 className="size-5" />,
                onSelect: onDelete,
              },
            ]
          : []
      }
      oppositeActions={
        onOpen
          ? [
              {
                id: "details",
                label: "Детали",
                color: "var(--control-hover)",
                icon: <ArrowUpRight className="size-5" />,
                onSelect: onOpen,
              },
            ]
          : []
      }
      onSurfaceHold={onHold}
      label={label}
      height="auto"
      radius={mobileRecordRadius}
      fullSwipe={false}
      actionColor="var(--destructive)"
      drawerColor="var(--control-hover)"
      rowColor="transparent"
      textColor="var(--foreground)"
      surfaceClassName="!block !h-auto !p-0 rounded-[inherit]"
      onSurfaceTap={onTap ?? onOpen}
    >
      <div className="w-full min-w-0 rounded-[inherit]">{children}</div>
    </SwipeRow>
  )
}
