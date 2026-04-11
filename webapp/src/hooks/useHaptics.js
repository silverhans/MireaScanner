import { useEffect } from 'react'

const tg = window.Telegram?.WebApp

export default function useHaptics(hapticsEnabled) {
  function triggerImpactHaptic(style = 'light') {
    if (!hapticsEnabled) return
    const haptic = tg?.HapticFeedback
    if (!haptic || typeof haptic.impactOccurred !== 'function') return
    try { haptic.impactOccurred(style) } catch (_e) {}
  }

  function triggerSelectionHaptic() {
    if (!hapticsEnabled) return
    const haptic = tg?.HapticFeedback
    if (!haptic) return
    try {
      if (typeof haptic.selectionChanged === 'function') haptic.selectionChanged()
      else if (typeof haptic.impactOccurred === 'function') haptic.impactOccurred('light')
    } catch (_e) {}
  }

  function triggerNotificationHaptic(kind = 'success') {
    if (!hapticsEnabled) return
    const haptic = tg?.HapticFeedback
    if (!haptic || typeof haptic.notificationOccurred !== 'function') return
    try { haptic.notificationOccurred(kind) } catch (_e) {}
  }

  // Global button haptics: one delegated listener for all taps.
  useEffect(() => {
    const haptic = tg?.HapticFeedback
    if (!haptic || !hapticsEnabled) return

    const onPress = (event) => {
      if (event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (!target) return

      const toggleControl = target.closest('label.share-toggle, label.friends-checkbox, input[type="checkbox"], input[type="radio"]')
      if (toggleControl) {
        if (toggleControl instanceof HTMLInputElement && toggleControl.disabled) return
        if (toggleControl.getAttribute('aria-disabled') === 'true') return
        if (toggleControl.dataset?.noHaptic === 'true') return
        try {
          if (typeof haptic.selectionChanged === 'function') haptic.selectionChanged()
          else if (typeof haptic.impactOccurred === 'function') haptic.impactOccurred('light')
        } catch (_e) {}
        return
      }

      const control = target.closest('button, [role="button"], a.menu-btn')
      if (!control) return
      if (control instanceof HTMLButtonElement && control.disabled) return
      if (control.getAttribute('aria-disabled') === 'true') return
      if (control.dataset?.noHaptic === 'true') return

      try {
        if (control.classList.contains('tab') && typeof haptic.selectionChanged === 'function') {
          haptic.selectionChanged()
        } else if (typeof haptic.impactOccurred === 'function') {
          haptic.impactOccurred('light')
        }
      } catch (_e) {}
    }

    document.addEventListener('click', onPress, true)
    return () => document.removeEventListener('click', onPress, true)
  }, [hapticsEnabled])

  return { triggerImpactHaptic, triggerSelectionHaptic, triggerNotificationHaptic }
}
