"use client"
import { createContext } from "react"
export type EntityExport = {
  csv: string
  filename: string
  rows: number
  loaded: number
  total: number
  loading: boolean
}
export const EntityExportContext = createContext<
  ((value: EntityExport | null) => void) | null
>(null)
