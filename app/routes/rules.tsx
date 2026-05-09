import { useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { playClick } from '~/hooks/use-sound-engine'
import { useT } from '~/lib/use-t'

export function meta() {
  return [{ title: 'Rules · Pupatao' }]
}

export default function RulesPage() {
  const navigate = useNavigate()
  const t = useT()

  return (
    <div className="min-h-screen font-sans" style={{ background: '#0d0024' }}>
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{ background: '#1e0040', borderBottom: '1px solid #a78bfa' }}
      >
        <button
          onClick={() => { playClick(); navigate(-1) }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-opacity hover:opacity-80"
          style={{ background: '#4c1d95', color: '#e9d5ff', border: '1px solid #7c3aed' }}
        >
          <ArrowLeft size={16} />
          {t('common.back')}
        </button>
        <h1 className="text-base font-bold sm:text-lg" style={{ color: '#fde68a' }}>
          {t('rules.headerTitle')}
        </h1>
      </header>

      <article
        className="mx-auto max-w-2xl px-5 py-6 text-sm leading-relaxed sm:text-[15px]"
        style={{ color: '#e9d5ff' }}
      >
        <h2 className="mb-3 text-lg font-bold sm:text-xl" style={{ color: '#fde68a' }}>
          {t('rules.title')}
        </h2>
        <p className="mb-6">{t('rules.intro')}</p>

        {/* ── 1. Betting & payouts ───────────────────────────── */}
        <h3 className="mb-3 text-base font-bold sm:text-lg" style={{ color: '#fde68a' }}>
          {t('rules.s1.title')}
        </h3>
        <ul className="mb-6 list-disc space-y-2 pl-5">
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s1.b1.label')}:</span>{' '}
            {t('rules.s1.b1.text')}
          </li>
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s1.b2.label')}:</span>{' '}
            {t('rules.s1.b2.before')}{' '}
            <mark
              className="rounded px-1 font-semibold"
              style={{ background: 'rgba(74,222,128,0.25)', color: '#bbf7d0' }}
            >
              {t('rules.s1.b2.highlight')}
            </mark>
          </li>
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s1.b3.label')}:</span>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s1.b3a.label')}:</span>{' '}
                {t('rules.s1.b3a.text')}
              </li>
              <li>
                <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s1.b3b.label')}:</span>{' '}
                {t('rules.s1.b3b.text')}
              </li>
            </ul>
          </li>
        </ul>

        {/* ── 2. Refund policy ───────────────────────────────── */}
        <h3 className="mb-3 text-base font-bold sm:text-lg" style={{ color: '#fde68a' }}>
          {t('rules.s2.title')}
        </h3>
        <ul className="mb-6 list-disc space-y-2 pl-5">
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s2.b1.label')}:</span>{' '}
            {t('rules.s2.b1.before')}{' '}
            <strong style={{ color: '#fde68a' }}>{t('rules.s2.b1.bold')}</strong>{' '}
            {t('rules.s2.b1.after')}
          </li>
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s2.b2.label')}:</span>{' '}
            {t('rules.s2.b2.before')}{' '}
            <strong style={{ color: '#fde68a' }}>{t('rules.s2.b2.bold')}</strong>{' '}
            {t('rules.s2.b2.after')}
          </li>
        </ul>

        {/* ── 3. Anti-fraud ──────────────────────────────────── */}
        <h3 className="mb-3 text-base font-bold sm:text-lg" style={{ color: '#fde68a' }}>
          {t('rules.s3.title')}
        </h3>
        <ul className="mb-6 list-disc space-y-2 pl-5">
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s3.b1.label')}:</span>{' '}
            {t('rules.s3.b1.before')}{' '}
            <strong style={{ color: '#fde68a' }}>{t('rules.s3.b1.bold')}</strong>
            {t('rules.s3.b1.after')}
          </li>
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s3.b2.label')}:</span>{' '}
            {t('rules.s3.b2.before')}{' '}
            <strong style={{ color: '#fde68a' }}>{t('rules.s3.b2.bold')}</strong>{' '}
            {t('rules.s3.b2.after')}
          </li>
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s3.b3.label')}:</span>{' '}
            {t('rules.s3.b3.before')}{' '}
            <strong style={{ color: '#fde68a' }}>{t('rules.s3.b3.boldA')}</strong>{' '}
            {t('rules.s3.b3.middle')}{' '}
            <strong style={{ color: '#fde68a' }}>{t('rules.s3.b3.boldB')}</strong>{' '}
            {t('rules.s3.b3.after')}
          </li>
        </ul>

        {/* ── 4. Promotions & bonuses ────────────────────────── */}
        <h3 className="mb-3 text-base font-bold sm:text-lg" style={{ color: '#fde68a' }}>
          {t('rules.s4.title')}
        </h3>
        <ul className="mb-6 list-disc space-y-2 pl-5">
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s4.b1.label')}:</span>{' '}
            {t('rules.s4.b1.text')}
          </li>
          <li>
            <span className="font-bold" style={{ color: '#fde68a' }}>{t('rules.s4.b2.label')}:</span>{' '}
            {t('rules.s4.b2.text')}
          </li>
        </ul>

        {/* ── Warning ───────────────────────────────────────── */}
        <div className="mt-6 border-t pt-5" style={{ borderColor: '#4c1d95' }}>
          <p>
            <strong style={{ color: '#fde68a' }}>{t('rules.warningLabel')}:</strong>{' '}
            {t('rules.warningText')}
          </p>
        </div>
      </article>
    </div>
  )
}
