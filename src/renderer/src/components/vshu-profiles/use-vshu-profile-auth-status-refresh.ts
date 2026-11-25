import { useEffect } from 'react'
import { useAppStore } from '../../store/index'

/** Refresh cached auth on surface mount so post-launch revocation appears; retain the cached display while fetching. */
export function useVshuProfileAuthStatusRefresh(): void {
  const fetchAuthStatus = useAppStore((state) => state.fetchVshuProfileAuthStatus)
  useEffect(() => {
    void fetchAuthStatus()
  }, [fetchAuthStatus])
}
