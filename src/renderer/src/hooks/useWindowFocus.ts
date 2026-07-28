import { useEffect } from 'react'

/**
 * Mirrors the window's focus state onto <html> as a `window-blurred` class.
 * Used by `.traffic-light-shade` to add contrast behind the macOS window
 * buttons, which the OS greys out to near-invisibility when the window is
 * inactive. Kept as a class (not store state) so it never re-renders the app.
 */
export const useWindowFocus = (): void => {
  useEffect(() => {
    const apply = (blurred: boolean): void => {
      document.documentElement.classList.toggle('window-blurred', blurred)
    }

    apply(!document.hasFocus())

    const onFocus = (): void => apply(false)
    const onBlur = (): void => apply(true)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.documentElement.classList.remove('window-blurred')
    }
  }, [])
}
