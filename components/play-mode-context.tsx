"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import type { AppPlayMode } from "@/types/play-mode"

const STORAGE_KEY = "defiduel_play_mode"

type Ctx = {
  playMode: AppPlayMode
  setPlayMode: (m: AppPlayMode) => void
}

const PlayModeContext = createContext<Ctx | null>(null)

export function PlayModeProvider({ children }: { children: React.ReactNode }) {
  const [playMode, setPlayModeState] = useState<AppPlayMode>("friendly")

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === "duel" || raw === "friendly") {
        setPlayModeState(raw)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const setPlayMode = useCallback((m: AppPlayMode) => {
    setPlayModeState(m)
    try {
      window.localStorage.setItem(STORAGE_KEY, m)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(
    () => ({ playMode, setPlayMode }),
    [playMode, setPlayMode],
  )

  return (
    <PlayModeContext.Provider value={value}>{children}</PlayModeContext.Provider>
  )
}

export function usePlayMode(): Ctx {
  const v = useContext(PlayModeContext)
  if (!v) {
    return {
      playMode: "friendly",
      setPlayMode: () => {},
    }
  }
  return v
}
