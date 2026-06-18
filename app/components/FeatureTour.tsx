import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useT } from '~/lib/use-t'
import type { StringKey } from '~/lib/i18n'

export interface TourStep {
  id: string
  // CSS selector for the target element. Multiple elements may match (e.g.
  // separate mobile/desktop trees) — the engine picks the first one that's
  // actually visible (non-zero bounding rect). If none are visible, the step
  // renders as a centered card with no spotlight cutout.
  selector: string
  titleKey: StringKey
  bodyKey: StringKey
}

interface FeatureTourProps {
  steps: TourStep[]
  open: boolean
  onClose: () => void
  onFinish: () => void
}

const PADDING = 8
const MARGIN = 14

function findVisibleTarget(selector: string): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(selector)
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

export function FeatureTour({ steps, open, onClose, onFinish }: FeatureTourProps) {
  const t = useT()
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' | 'center' } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const step = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1

  // Reset to step 0 every time the tour is (re)opened.
  useEffect(() => {
    if (open) setStepIndex(0)
  }, [open])

  // Locate + measure the current step's target. Re-measures on resize/scroll
  // so the spotlight tracks layout changes (e.g. orientation change).
  useEffect(() => {
    if (!open || !step) return
    let cancelled = false

    function measure() {
      const el = findVisibleTarget(step.selector)
      if (!el) {
        if (!cancelled) setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      if (!cancelled) setRect(r)
    }

    const el = findVisibleTarget(step.selector)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Measure now and again after the smooth-scroll settles.
      measure()
      const t1 = setTimeout(measure, 320)
      window.addEventListener('resize', measure)
      window.addEventListener('scroll', measure, true)
      return () => {
        cancelled = true
        clearTimeout(t1)
        window.removeEventListener('resize', measure)
        window.removeEventListener('scroll', measure, true)
      }
    }
    setRect(null)
    window.addEventListener('resize', measure)
    return () => {
      cancelled = true
      window.removeEventListener('resize', measure)
    }
  }, [open, step])

  // Position the tooltip relative to the measured target (or centered if
  // there's no target). Two-pass: render off-screen first, measure its own
  // size, then place it precisely — avoids guessing a fixed tooltip height.
  useLayoutEffect(() => {
    if (!open) return
    const tt = tooltipRef.current
    if (!tt) return
    const tw = tt.offsetWidth
    const th = tt.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (!rect) {
      setTooltipPos({ top: vh / 2 - th / 2, left: vw / 2 - tw / 2, placement: 'center' })
      return
    }

    const spaceBelow = vh - rect.bottom
    const spaceAbove = rect.top
    let top: number
    let placement: 'top' | 'bottom'
    if (spaceBelow >= th + MARGIN + PADDING || spaceBelow >= spaceAbove) {
      top = rect.bottom + PADDING + MARGIN
      placement = 'bottom'
    } else {
      top = rect.top - PADDING - MARGIN - th
      placement = 'top'
    }
    top = Math.min(Math.max(MARGIN, top), vh - th - MARGIN)

    let left = rect.left + rect.width / 2 - tw / 2
    left = Math.min(Math.max(MARGIN, left), vw - tw - MARGIN)

    setTooltipPos({ top, left, placement })
  }, [open, rect, stepIndex])

  // Esc skips the tour.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !step) return null

  function next() {
    if (isLast) {
      onFinish()
    } else {
      setStepIndex(i => i + 1)
    }
  }
  function back() {
    setStepIndex(i => Math.max(0, i - 1))
  }

  const spotlightStyle: React.CSSProperties = rect
    ? {
      position: 'fixed',
      top: rect.top - PADDING,
      left: rect.left - PADDING,
      width: rect.width + PADDING * 2,
      height: rect.height + PADDING * 2,
      borderRadius: 14,
      border: '2px solid #facc15',
      boxShadow: '0 0 0 9999px rgba(5,0,15,0.86), 0 0 28px rgba(250,204,21,0.55)',
      transition: 'top 280ms ease, left 280ms ease, width 280ms ease, height 280ms ease',
      pointerEvents: 'none',
      zIndex: 1,
    }
    : {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: 0,
      height: 0,
      boxShadow: '0 0 0 9999px rgba(5,0,15,0.9)',
      pointerEvents: 'none',
      zIndex: 1,
    }

  return (
    <div className="fixed inset-0 z-[500]" role="dialog" aria-modal="true" aria-label="Feature tour">
      <div style={spotlightStyle} aria-hidden />

      <div
        ref={tooltipRef}
        className="fixed w-[88vw] max-w-[340px] rounded-2xl p-5 transition-opacity duration-150"
        style={{
          top: tooltipPos?.top ?? -9999,
          left: tooltipPos?.left ?? -9999,
          opacity: tooltipPos ? 1 : 0,
          background: 'linear-gradient(160deg, #2d1b4e 0%, #1e0040 100%)',
          border: '1.5px solid #a78bfa',
          boxShadow: '0 12px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(167,139,250,0.15)',
          zIndex: 2,
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ background: 'rgba(124,58,237,0.35)', color: '#e9d5ff' }}
          >
            {t('tour.stepOf', { current: String(stepIndex + 1), total: String(steps.length) })}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('tour.skip')}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ background: '#4c1d95', color: '#c4b5fd' }}
          >
            <X size={13} />
          </button>
        </div>

        <h3 className="mb-1.5 text-base font-bold" style={{ color: '#fde68a' }}>
          {t(step.titleKey)}
        </h3>
        <p className="text-[13px] leading-relaxed" style={{ color: '#e9d5ff' }}>
          {t(step.bodyKey)}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === stepIndex ? 16 : 6,
                  background: i === stepIndex ? '#fde68a' : 'rgba(167,139,250,0.4)',
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={back}
                className="rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-90"
                style={{ background: '#4c1d95', color: '#e9d5ff', border: '1px solid #7c3aed' }}
              >
                {t('common.back')}
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="rounded-lg px-4 py-1.5 text-xs font-bold transition-opacity hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                color: '#fff',
                border: '1px solid #4ade80',
                boxShadow: '0 0 14px rgba(22,163,74,0.4)',
              }}
            >
              {isLast ? t('tour.finish') : t('tour.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
