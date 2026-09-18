"use client"

import { useEffect, useState } from "react"

export function usePageSearch() {
  const [query, setQuery] = useState("")
  useEffect(() => {
    const sync = () => setQuery(new URLSearchParams(window.location.search).get("q")?.slice(0,120) ?? "")
    const timer = window.setTimeout(sync,0)
    window.addEventListener("popstate",sync)
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate",sync) }
  },[])
  return [query,setQuery] as const
}
