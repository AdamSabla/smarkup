import { useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'

/**
 * Applies the active theme to the <html> element by toggling the `dark`
 * class (which the Tailwind v4 `@custom-variant dark` rule is wired to).
 * `system` follows prefers-color-scheme and reacts to changes.
 */
export const useTheme = (): void => {
  const theme = useWorkspace((s) => s.theme)

  useEffect(() => {
    const apply = (prefersDark: boolean): void => {
      const root = document.documentElement
      const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
      root.classList.toggle('dark', isDark)
      root.style.colorScheme = isDark ? 'dark' : 'light'
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    apply(media.matches)

    if (theme !== 'system') return

    const listener = (e: MediaQueryListEvent): void => apply(e.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [theme])
}
