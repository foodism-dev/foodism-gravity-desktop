import * as React from 'react'

export interface NativeBrowserOverlayChangeDetail {
  open: boolean
  count: number
}

export const NATIVE_BROWSER_OVERLAY_CHANGE_EVENT = 'proma:native-browser-overlay-change'

let openOverlayCount = 0

function dispatchOverlayChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<NativeBrowserOverlayChangeDetail>(
    NATIVE_BROWSER_OVERLAY_CHANGE_EVENT,
    {
      detail: {
        open: openOverlayCount > 0,
        count: openOverlayCount,
      },
    },
  ))
}

export function setNativeBrowserOverlayOpen(open: boolean): void {
  const nextCount = open ? openOverlayCount + 1 : Math.max(0, openOverlayCount - 1)
  if (nextCount === openOverlayCount) return
  openOverlayCount = nextCount
  dispatchOverlayChange()
}

export function useNativeBrowserOverlayOpen(): boolean {
  const [open, setOpen] = React.useState(openOverlayCount > 0)

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleChange = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as Partial<NativeBrowserOverlayChangeDetail>
      setOpen(detail.open === true)
    }
    window.addEventListener(NATIVE_BROWSER_OVERLAY_CHANGE_EVENT, handleChange)
    return () => window.removeEventListener(NATIVE_BROWSER_OVERLAY_CHANGE_EVENT, handleChange)
  }, [])

  return open
}

export function useNativeBrowserOverlayTracker(
  controlledOpen: boolean | undefined,
  onOpenChange?: (open: boolean) => void,
): (open: boolean) => void {
  const trackedOpenRef = React.useRef(false)

  const syncTrackedOpen = React.useCallback((open: boolean): void => {
    if (trackedOpenRef.current === open) return
    trackedOpenRef.current = open
    setNativeBrowserOverlayOpen(open)
  }, [])

  React.useEffect(() => {
    if (typeof controlledOpen === 'boolean') {
      syncTrackedOpen(controlledOpen)
    }
  }, [controlledOpen, syncTrackedOpen])

  React.useEffect(() => {
    return () => {
      if (!trackedOpenRef.current) return
      trackedOpenRef.current = false
      setNativeBrowserOverlayOpen(false)
    }
  }, [])

  return React.useCallback((open: boolean): void => {
    syncTrackedOpen(open)
    onOpenChange?.(open)
  }, [onOpenChange, syncTrackedOpen])
}
