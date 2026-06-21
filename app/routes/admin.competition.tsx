import { useEffect, useState } from 'react'
import { useFetcher, useLoaderData, useRevalidator } from 'react-router'
import { CalendarClock, Check, Flag, Loader, Plus, RotateCcw, Trophy, X } from 'lucide-react'
import type { Route } from './+types/admin.competition'
import { requireAdmin, requireRole } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import {
  COMPETITION_STARTED_KEY,
  getCompetitionConfig,
  setCompetitionEnabled,
  setCompetitionConfig,
  setCompetitionSummary,
  type CompetitionType,
  type CompetitionWinner,
} from '~/lib/system-settings.server'
import { notifyCompetition } from '~/lib/pusher.server'
import { COMPETITION_CHANNEL, type RankingUpdatedPayload } from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import { useT } from '~/lib/use-t'
import { t as translate, parseLocaleCookie, type StringKey } from '~/lib/i18n'

function isoToDatetimeLocal(iso: string) {
  const local = new Date(new Date(iso).getTime() + 7 * 60 * 60_000)
  return local.toISOString().slice(0, 16)
}
function fmtGMT7(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// Translation keys per competition type; resolved at render via t().
const TYPE_LABELS: Record<CompetitionType, { labelKey: StringKey; descKey: StringKey; color: string }> = {
  DEMO_LIVE: { labelKey: 'admin.competition.type.demoLive.label', color: '#a5b4fc', descKey: 'admin.competition.type.demoLive.desc' },
  REAL_LIVE: { labelKey: 'admin.competition.type.realLive.label', color: '#fbbf24', descKey: 'admin.competition.type.realLive.desc' },
  REAL_ALL:  { labelKey: 'admin.competition.type.realAll.label', color: '#fb923c', descKey: 'admin.competition.type.realAll.desc' },
}

// ─── LOADER ──────────────────────────────────────────────────────────
export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, ['ADMIN', 'SUPERADMIN'])

  const [competition, historyList, participantRows] = await Promise.all([
    getCompetitionConfig(),
    prisma.competitionHistory.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, type: true, rules: true, startDate: true, endDate: true,
        totalParticipants: true, createdAt: true,
      },
    }),
    // Load participants for Type B/C active competition
    prisma.competitionParticipant.findMany({
      orderBy: { joinedAt: 'asc' },
      include: { user: { select: { id: true, tel: true, firstName: true, lastName: true, profile: true } } },
    }),
  ])

  const walletField = competition.type === 'DEMO_LIVE' ? 'DEMO' : 'REAL'
  const users = await prisma.user.findMany({
    select: {
      id: true, tel: true, firstName: true, lastName: true, profile: true, createdAt: true,
      wallets: { where: { type: walletField }, select: { balance: true } },
    },
  })

  const betAggs = await prisma.transaction.groupBy({
    by: ['userId'],
    where: { type: 'LOSS' },
    _sum: { amount: true },
  })
  const betsByUser = new Map(betAggs.map(b => [b.userId, b._sum.amount ?? 0]))

  const ranked = users
    .map(u => ({
      id: u.id, tel: u.tel,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
      profile: u.profile as string | null,
      createdAt: u.createdAt.toISOString(),
      balance: u.wallets[0]?.balance ?? 0,
      totalBets: betsByUser.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.balance - a.balance)
    .map((u, i) => ({ ...u, rank: i + 1 }))

  return {
    competition, ranked,
    participants: participantRows.map(p => ({
      id: p.id, userId: p.user.id, tel: p.user.tel,
      name: [p.user.firstName, p.user.lastName].filter(Boolean).join(' ') || null,
      profile: p.user.profile as string | null,
      joinedAt: p.joinedAt.toISOString(),
    })),
    historyList: historyList.map(h => ({
      id: h.id, type: h.type, rules: h.rules,
      startDate: h.startDate?.toISOString() ?? null,
      endDate: h.endDate.toISOString(),
      totalParticipants: h.totalParticipants,
      createdAt: h.createdAt.toISOString(),
    })),
  }
}

// ─── ACTION ──────────────────────────────────────────────────────────
export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)
  // Errors translated server-side from the locale cookie (actions can't use the hook).
  const locale = parseLocaleCookie(request.headers.get('cookie'))
  if (admin.role === 'SUPPORT') return { error: translate(locale, 'admin.competition.err.insufficientPermissions') }
  const fd = await request.formData()
  const op = String(fd.get('op') ?? '')

  if (op === 'toggleCompetition') {
    const { getCompetitionEnabled } = await import('~/lib/system-settings.server')
    const current = await getCompetitionEnabled()
    const next = !current
    await setCompetitionEnabled(next, admin.id)
    // Mark as started the first time it goes live
    if (next) {
      await prisma.systemSetting.upsert({
        where: { key: COMPETITION_STARTED_KEY },
        create: { key: COMPETITION_STARTED_KEY, value: 'true', updatedBy: admin.id },
        update: { value: 'true', updatedBy: admin.id },
      })
    }
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: next ? 'competition.start' : 'competition.stop' },
    })
    notifyCompetition('competition:toggled', { enabled: next })
    return { ok: true }
  }

  if (op === 'saveCompetitionConfig') {
    const type       = String(fd.get('type') ?? 'DEMO_LIVE') as CompetitionType
    const rules      = String(fd.get('rules') ?? '').trim() || null
    const startLocal = String(fd.get('start') ?? '').trim()
    const endLocal   = String(fd.get('end')   ?? '').trim()
    const start = startLocal ? new Date(`${startLocal}:00+07:00`).toISOString() : null
    const end   = endLocal   ? new Date(`${endLocal}:00+07:00`).toISOString()   : null
    await setCompetitionConfig({ type, rules, start, end }, admin.id)
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'competition.configure', metadata: { type, rules, start, end } },
    })
    return { ok: true }
  }

  if (op === 'resetAllDemo') {
    const RESET_AMOUNT = 1_000_000
    const count = await prisma.wallet.count({ where: { type: 'DEMO' } })
    await Promise.all([
      prisma.wallet.updateMany({ where: { type: 'DEMO' }, data: { balance: RESET_AMOUNT } }),
      prisma.auditLog.create({
        data: { actorId: admin.id, action: 'competition.demo_reset_all', target: 'all', metadata: { count, resetTo: RESET_AMOUNT } },
      }),
    ])
    notifyCompetition('competition:reset', { newBalance: RESET_AMOUNT })
    return { ok: true }
  }

  if (op === 'summarize') {
    const config = await getCompetitionConfig()
    const walletField = config.type === 'DEMO_LIVE' ? 'DEMO' : 'REAL'
    const users = await prisma.user.findMany({
      select: {
        id: true, tel: true, firstName: true, lastName: true, profile: true,
        wallets: { where: { type: walletField }, select: { balance: true } },
      },
    })
    const top3: CompetitionWinner[] = users
      .map(u => ({
        rank: 0,
        userId: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
        tel: u.tel,
        profile: u.profile as string | null,
        demoBalance: u.wallets[0]?.balance ?? 0,
      }))
      .sort((a, b) => b.demoBalance - a.demoBalance)
      .slice(0, 3)
      .map((w, i) => ({ ...w, rank: i + 1 }))
    await setCompetitionSummary(top3, admin.id)
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'competition.summarize', metadata: { top3Count: top3.length } },
    })
    notifyCompetition('competition:summarized', { winners: top3 })
    return { ok: true }
  }

  if (op === 'removeParticipant') {
    const userId = String(fd.get('userId') ?? '')
    if (!userId) return { error: translate(locale, 'admin.competition.err.userIdRequired') }
    await prisma.competitionParticipant.deleteMany({ where: { userId } })
    const total = await prisma.competitionParticipant.count()
    notifyCompetition('competition:participantChanged', { totalParticipants: total })
    return { ok: true }
  }

  if (op === 'endCompetition') {
    const config = await getCompetitionConfig()
    // Resolve who configured and who started from SystemSetting.updatedBy
    const [configuredBySetting, startedBySetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'competitionType' }, select: { updatedBy: true } }),
      prisma.systemSetting.findUnique({ where: { key: COMPETITION_STARTED_KEY }, select: { updatedBy: true } }),
    ])
    const walletType = config.type === 'DEMO_LIVE' ? 'DEMO' : 'REAL'
    const totalParticipants = await prisma.user.count({
      where: { wallets: { some: { type: walletType, balance: { gt: 0 } } } },
    })
    await prisma.competitionHistory.create({
      data: {
        type:          config.type,
        rules:         config.rules,
        startDate:     config.start ? new Date(config.start) : null,
        endDate:       config.end   ? new Date(config.end)   : new Date(),
        winners:       JSON.parse(JSON.stringify(config.summary ?? [])),
        totalParticipants,
        configuredBy:  configuredBySetting?.updatedBy ?? null,
        startedBy:     startedBySetting?.updatedBy    ?? null,
        endedBy:       admin.id,
      },
    })
    // Clear ALL competition settings + participants
    await Promise.all([
      setCompetitionEnabled(false, admin.id),
      setCompetitionSummary(null, admin.id),
      setCompetitionConfig({ rules: null, start: null, end: null }, admin.id),
      prisma.systemSetting.deleteMany({
        where: { key: { in: ['competitionType', COMPETITION_STARTED_KEY] } },
      }),
      prisma.competitionParticipant.deleteMany({}),
      prisma.auditLog.create({
        data: { actorId: admin.id, action: 'competition.end', metadata: { type: config.type, totalParticipants } },
      }),
    ])
    notifyCompetition('competition:ended', {})
    return { ok: true }
  }

  return { error: translate(locale, 'admin.competition.err.unknownOp') }
}

// ─── PAGE ─────────────────────────────────────────────────────────────
export default function AdminCompetition() {
  const t = useT()
  const { competition, ranked: initialRanked, historyList, participants: initialParticipants } = useLoaderData<typeof loader>()
  const revalidator = useRevalidator()
  const [ranked, setRanked] = useState(initialRanked)
  const [showResetConfirm, setShowResetConfirm]   = useState(false)
  const [showEndConfirm, setShowEndConfirm]         = useState(false)
  const [showConfig, setShowConfig]                 = useState(false)
  const [showNewForm, setShowNewForm]               = useState(false)
  const [participants, setParticipants] = useState(initialParticipants)
  const toggleFetcher   = useFetcher<{ ok?: boolean }>()
  const configFetcher   = useFetcher<{ ok?: boolean }>()
  const resetFetcher    = useFetcher<{ ok?: boolean }>()
  const summaryFetcher  = useFetcher<{ ok?: boolean }>()
  const endFetcher      = useFetcher<{ ok?: boolean }>()
  const removeFetcher   = useFetcher<{ ok?: boolean }>()

  useEffect(() => { setRanked(initialRanked) }, [initialRanked])
  useEffect(() => { setParticipants(initialParticipants) }, [initialParticipants])
  useEffect(() => { if (configFetcher.state === 'idle' && configFetcher.data?.ok) { setShowConfig(false); setShowNewForm(false) } }, [configFetcher.state, configFetcher.data])
  useEffect(() => { if (resetFetcher.state === 'idle' && resetFetcher.data?.ok) setShowResetConfirm(false) }, [resetFetcher.state, resetFetcher.data])
  useEffect(() => { if (endFetcher.state === 'idle' && endFetcher.data?.ok) setShowEndConfirm(false) }, [endFetcher.state, endFetcher.data])

  usePusherEvent<RankingUpdatedPayload>(COMPETITION_CHANNEL, 'ranking:updated', () => { revalidator.revalidate() })

  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : n.toLocaleString()
  const rankColor = (r: number) => r === 1 ? '#fbbf24' : r === 2 ? '#94a3b8' : r === 3 ? '#fb923c' : '#a5b4fc'
  const rankMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`

  // Button state logic
  const isRunning   = competition.enabled
  const isStopped   = !competition.enabled && competition.hasConfig
  const hasSummary  = competition.summary !== null
  const noCompetition = !competition.hasConfig && !competition.enabled  // blank slate
  const typeInfo    = TYPE_LABELS[competition.type]
  const isDemo      = competition.type === 'DEMO_LIVE'

  // Disabled states
  // Summary: only enabled when stopped AND was started at least once
  const summaryDisabled = isRunning || !competition.wasStarted
  const endDisabled     = isRunning || !hasSummary  // only enabled when stopped + summarized
  const configDisabled  = isRunning   // can't reconfigure while running

  const ConfigForm = ({ isNew }: { isNew?: boolean }) => (
    <configFetcher.Form method="post" className="flex flex-col gap-3">
      <input type="hidden" name="op" value="saveCompetitionConfig" />

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.form.typeLabel')}</label>
        <div className="flex flex-col gap-1.5">
          {(Object.keys(TYPE_LABELS) as CompetitionType[]).map(ct => (
            <label key={ct} className="flex items-start gap-2 cursor-pointer rounded-lg px-3 py-2"
              style={{ background: '#1e1b4b', border: '1px solid #4338ca' }}>
              <input type="radio" name="type" value={ct} defaultChecked={competition.type === ct || (isNew && ct === 'DEMO_LIVE')}
                className="mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-bold" style={{ color: TYPE_LABELS[ct].color }}>{t(TYPE_LABELS[ct].labelKey)}</div>
                <div className="text-[10px]" style={{ color: '#64748b' }}>{t(TYPE_LABELS[ct].descKey)}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.form.rulesLabel')}</label>
        <textarea name="rules" defaultValue={isNew ? '' : (competition.rules ?? '')} rows={3}
          placeholder={t('admin.competition.form.rulesPlaceholder')}
          className="rounded-lg px-3 py-2 text-xs outline-none resize-none"
          style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.form.startLabel')}</label>
          <input name="start" type="datetime-local"
            defaultValue={(!isNew && competition.start) ? isoToDatetimeLocal(competition.start) : ''}
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.form.endLabel')}</label>
          <input name="end" type="datetime-local"
            defaultValue={(!isNew && competition.end) ? isoToDatetimeLocal(competition.end) : ''}
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: '#1e1b4b', color: '#fde68a', border: '1px solid #4338ca' }} />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => isNew ? setShowNewForm(false) : setShowConfig(false)}
          className="rounded-lg px-3 py-2 text-xs font-bold"
          style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
          <X size={12} className="inline mr-1" />{t('admin.competition.form.cancel')}
        </button>
        <button type="submit" disabled={configFetcher.state !== 'idle'}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#4338ca,#312e81)', color: '#fff', border: '1px solid #818cf8' }}>
          {configFetcher.state !== 'idle' ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
          {isNew ? t('admin.competition.form.create') : t('admin.competition.form.saveChanges')}
        </button>
      </div>
    </configFetcher.Form>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: '#fbbf24' }}>
          <Trophy size={20} /> {t('admin.competition.title')}
        </h1>
        <span className="text-xs" style={{ color: '#a5b4fc' }}>{t('admin.competition.playersCount', { n: ranked.length })}</span>
      </div>

      {/* ── NEW COMPETITION (blank slate) ── */}
      {noCompetition && (
        <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          {!showNewForm ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <Trophy size={32} style={{ color: '#4338ca' }} />
              <div>
                <div className="text-sm font-bold" style={{ color: '#fde68a' }}>{t('admin.competition.blank.title')}</div>
                <div className="mt-0.5 text-xs" style={{ color: '#64748b' }}>{t('admin.competition.blank.subtitle')}</div>
              </div>
              <button type="button" onClick={() => setShowNewForm(true)}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold"
                style={{ background: 'linear-gradient(135deg,#4338ca,#312e81)', color: '#fff', border: '1px solid #818cf8' }}>
                <Plus size={14} /> {t('admin.competition.blank.newButton')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#fbbf24' }}>
                <Plus size={14} /> {t('admin.competition.blank.newButton')}
              </div>
              <ConfigForm isNew />
            </div>
          )}
        </div>
      )}

      {/* ── PAST COMPETITIONS LIST ── */}
      {historyList.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          <div className="px-4 py-3 text-[10px] font-bold" style={{ background: '#1e1b4b', color: '#a5b4fc' }}>
            {t('admin.competition.history.heading', { n: historyList.length })}
          </div>
          <table className="w-full text-left text-xs hidden md:table">
            <thead>
              <tr className="text-[10px] font-bold" style={{ background: '#0f172a', color: '#64748b' }}>
                <th className="w-8 px-3 py-2 text-right">#</th>
                <th className="px-3 py-2">{t('admin.competition.history.col.detail')}</th>
                <th className="px-3 py-2">{t('admin.competition.history.col.type')}</th>
                <th className="px-3 py-2">{t('admin.competition.history.col.startDate')}</th>
                <th className="px-3 py-2">{t('admin.competition.history.col.endDate')}</th>
                <th className="px-3 py-2 text-right">{t('admin.competition.history.col.applicants')}</th>
                <th className="px-3 py-2">{t('admin.competition.history.col.status')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {historyList.map((h, i) => {
                const detail = h.rules ?? t('admin.competition.history.fallbackDetail', { n: historyList.length - i })
                const shortDetail = detail.length > 30 ? detail.slice(0, 30) + '…' : detail
                const typeColor = h.type === 'DEMO_LIVE' ? '#a5b4fc' : '#fbbf24'
                const typeLabel = h.type === 'DEMO_LIVE' ? t('admin.competition.type.short.demoLive') : h.type === 'REAL_LIVE' ? t('admin.competition.type.short.realLive') : t('admin.competition.type.short.realAll')
                return (
                  <tr key={h.id} className="cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}
                    onClick={() => window.location.href = `/admin/competition/${h.id}`}>
                    <td className="px-3 py-2.5 text-right" style={{ color: '#64748b' }}>{historyList.length - i}</td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: '#fde68a' }}
                      title={detail}>{shortDetail}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                        style={{ background: `${typeColor}20`, color: typeColor, border: `1px solid ${typeColor}40` }}>
                        {typeLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[10px]" style={{ color: '#818cf8' }}>
                      {h.startDate ? fmtGMT7(h.startDate) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-[10px]" style={{ color: '#818cf8' }}>
                      {fmtGMT7(h.endDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold" style={{ color: '#fde68a' }}>
                      {h.totalParticipants.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                        style={{ background: 'rgba(22,163,74,0.15)', color: '#4ade80', border: '1px solid #16a34a' }}>
                        {t('admin.competition.history.completed')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <a href={`/admin/competition/${h.id}`}
                        onClick={e => e.stopPropagation()}
                        className="rounded-md px-2 py-1 text-[10px] font-bold hover:opacity-80"
                        style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
                        {t('admin.competition.history.view')}
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="flex flex-col gap-0 md:hidden">
            {historyList.map((h, i) => {
              const detail = h.rules ?? `Competition #${historyList.length - i}`
              const shortDetail = detail.length > 30 ? detail.slice(0, 30) + '…' : detail
              const typeLabel = h.type === 'DEMO_LIVE' ? t('admin.competition.type.short.demoLive') : h.type === 'REAL_LIVE' ? t('admin.competition.type.short.realLive') : t('admin.competition.type.short.realAll')
              return (
                <a key={h.id} href={`/admin/competition/${h.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:opacity-80 transition-opacity"
                  style={{ borderTop: '1px solid #1e1b4b' }}>
                  <span className="text-[10px] font-bold shrink-0" style={{ color: '#64748b' }}>
                    #{historyList.length - i}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold" style={{ color: '#fde68a' }}>{shortDetail}</div>
                    <div className="text-[10px]" style={{ color: '#818cf8' }}>
                      {t('admin.competition.history.mobileSummary', { type: typeLabel, n: h.totalParticipants, date: fmtGMT7(h.endDate) })}
                    </div>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold shrink-0"
                    style={{ background: 'rgba(22,163,74,0.15)', color: '#4ade80', border: '1px solid #16a34a' }}>
                    {t('admin.competition.history.completed')}
                  </span>
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* ── ACTIVE/STOPPED COMPETITION CONTROL ── */}
      {!noCompetition && (
        <div className="rounded-xl p-4"
          style={{
            background: isRunning ? 'rgba(234,179,8,0.08)' : '#0f172a',
            border: `1px solid ${isRunning ? '#ca8a04' : '#1e1b4b'}`,
          }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Trophy size={18} style={{ color: isRunning ? '#fbbf24' : '#818cf8' }} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: isRunning ? '#fbbf24' : '#fde68a' }}>
                    {t(typeInfo.labelKey)}
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{
                      background: isRunning ? 'rgba(234,179,8,0.2)' : hasSummary ? 'rgba(74,222,128,0.15)' : 'rgba(100,116,139,0.2)',
                      color: isRunning ? '#fbbf24' : hasSummary ? '#4ade80' : '#94a3b8',
                      border: `1px solid ${isRunning ? '#ca8a04' : hasSummary ? '#4ade80' : '#334155'}`,
                    }}>
                    {isRunning ? t('admin.competition.status.running') : hasSummary ? t('admin.competition.status.summarized') : t('admin.competition.status.stopped')}
                  </span>
                </div>
                {competition.start && (
                  <p className="text-[10px]" style={{ color: '#a5b4fc' }}>
                    {fmtGMT7(competition.start)} — {competition.end ? fmtGMT7(competition.end) : '?'} (GMT+7)
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Reset All Demo — only for DEMO_LIVE */}
              {isDemo && (
                <button type="button" onClick={() => setShowResetConfirm(true)}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-bold"
                  style={{ background: 'rgba(30,27,75,0.8)', color: '#a5b4fc', border: '1px solid #4338ca' }}>
                  <RotateCcw size={10} /> {t('admin.competition.resetAllDemo')}
                </button>
              )}

              {/* Configure (disabled when running) */}
              <button type="button" onClick={() => setShowConfig(v => !v)} disabled={configDisabled}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgba(30,27,75,0.8)', color: '#a5b4fc', border: '1px solid #4338ca' }}>
                <CalendarClock size={10} /> {t('admin.competition.configure')}
              </button>

              {/* Summary — disabled when running */}
              <summaryFetcher.Form method="post">
                <input type="hidden" name="op" value="summarize" />
                <button type="submit" disabled={summaryDisabled || summaryFetcher.state !== 'idle'}
                  title={isRunning ? t('admin.competition.summary.title.stopFirst') : !competition.wasStarted ? t('admin.competition.summary.title.startFirst') : t('admin.competition.summary.title.snapshot')}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: (!summaryDisabled && hasSummary) ? 'rgba(22,163,74,0.2)' : 'rgba(30,27,75,0.8)',
                    color: (!summaryDisabled && hasSummary) ? '#4ade80' : '#a5b4fc',
                    border: `1px solid ${(!summaryDisabled && hasSummary) ? '#16a34a' : '#4338ca'}`,
                  }}>
                  {summaryFetcher.state !== 'idle' ? <Loader size={10} className="animate-spin" /> : hasSummary ? <Check size={10} /> : <Trophy size={10} />}
                  {hasSummary ? t('admin.competition.summary.resummarize') : t('admin.competition.summary.button')}
                </button>
              </summaryFetcher.Form>

              {/* End Competition — disabled when running OR no summary */}
              <button type="button" onClick={() => setShowEndConfirm(true)}
                disabled={endDisabled}
                title={isRunning ? t('admin.competition.summary.title.stopFirst') : !hasSummary ? t('admin.competition.end.title.summarizeFirst') : t('admin.competition.end.title.endAndSave')}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: endDisabled ? 'rgba(100,116,139,0.2)' : 'rgba(127,29,29,0.4)',
                  color: endDisabled ? '#64748b' : '#fca5a5',
                  border: `1px solid ${endDisabled ? '#334155' : '#ef4444'}`,
                }}>
                <Flag size={10} /> {t('admin.competition.end.button')}
              </button>

              {/* Start / Stop */}
              <toggleFetcher.Form method="post">
                <input type="hidden" name="op" value="toggleCompetition" />
                <button type="submit" disabled={toggleFetcher.state !== 'idle'}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-bold disabled:opacity-50"
                  style={{
                    background: isRunning ? 'linear-gradient(135deg,#7f1d1d,#450a0a)' : 'linear-gradient(135deg,#14532d,#052e16)',
                    color: '#fff', border: `1px solid ${isRunning ? '#fca5a5' : '#4ade80'}`,
                  }}>
                  {isRunning ? t('admin.competition.stop') : t('admin.competition.start')}
                </button>
              </toggleFetcher.Form>
            </div>
          </div>

          {/* Summary snapshot */}
          {hasSummary && competition.summary && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: '#1e1b4b' }}>
              <div className="mb-2 text-[10px] font-bold" style={{ color: '#4ade80' }}>{t('admin.competition.finalSnapshot.heading')}</div>
              <div className="flex gap-3 flex-wrap">
                {competition.summary.map(w => (
                  <div key={w.userId} className="flex items-center gap-2 rounded-lg px-3 py-2"
                    style={{ background: '#1e1b4b', border: `1px solid ${rankColor(w.rank)}40` }}>
                    <span style={{ color: rankColor(w.rank), fontSize: 16 }}>{rankMedal(w.rank)}</span>
                    <Avatar name={w.name ?? w.tel} src={w.profile} size={24} />
                    <div>
                      <div className="text-xs font-bold" style={{ color: '#fde68a' }}>{w.name ?? w.tel}</div>
                      <div className="text-[10px]" style={{ color: rankColor(w.rank) }}>{fmt(w.demoBalance)} ₭</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Configure form */}
          {showConfig && !configDisabled && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: '#1e1b4b' }}>
              <ConfigForm />
            </div>
          )}
        </div>
      )}

      {/* ── PARTICIPANTS (Type B/C only) ── */}
      {!noCompetition && competition.type !== 'DEMO_LIVE' && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ background: '#1e1b4b' }}>
            <span className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>
              {t('admin.competition.participants.heading', { n: participants.length })}
            </span>
            <span className="text-[10px]" style={{ color: '#64748b' }}>
              {t('admin.competition.participants.subheading')}
            </span>
          </div>
          {participants.length === 0 ? (
            <div className="px-4 py-4 text-xs text-center" style={{ color: '#475569' }}>
              {t('admin.competition.participants.empty')}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: '#1e1b4b' }}>
              {participants.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[10px] shrink-0 tabular-nums" style={{ color: '#64748b' }}>{i + 1}</span>
                  <Avatar name={p.name ?? p.tel} src={p.profile} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold" style={{ color: '#fde68a' }}>{p.name ?? '—'}</div>
                    <div className="text-[10px]" style={{ color: '#818cf8' }}>{p.tel}</div>
                  </div>
                  <div className="text-[10px] shrink-0" style={{ color: '#64748b' }}>
                    {new Date(p.joinedAt).toLocaleDateString('en-GB')}
                  </div>
                  <removeFetcher.Form method="post">
                    <input type="hidden" name="op" value="removeParticipant" />
                    <input type="hidden" name="userId" value={p.userId} />
                    <button type="submit" disabled={removeFetcher.state !== 'idle'}
                      className="rounded-md px-2 py-1 text-[10px] font-bold disabled:opacity-50"
                      style={{ background: 'rgba(127,29,29,0.4)', color: '#fca5a5', border: '1px solid #ef444440' }}
                      title={t('admin.competition.participants.removeTitle')}>
                      {t('admin.competition.participants.remove')}
                    </button>
                  </removeFetcher.Form>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ranking table — desktop */}
      {!noCompetition && (
        <div className="hidden overflow-x-auto rounded-xl md:block" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] font-bold" style={{ background: '#1e1b4b', color: '#a5b4fc' }}>
                <th className="w-12 px-3 py-2 text-center">{t('admin.competition.ranking.col.rank')}</th>
                <th className="px-3 py-2">{t('admin.competition.ranking.col.player')}</th>
                <th className="px-3 py-2">{t('admin.competition.ranking.col.phone')}</th>
                <th className="px-3 py-2 text-right">{t('admin.competition.ranking.col.joined')}</th>
                <th className="px-3 py-2 text-right">{t('admin.competition.ranking.col.totalBets')}</th>
                <th className="px-3 py-2 text-right">{t('admin.competition.ranking.col.balance', { wallet: isDemo ? 'DEMO' : 'REAL' })}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid #1e1b4b', color: '#e9d5ff' }}>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-sm font-bold" style={{ color: rankColor(u.rank) }}>{rankMedal(u.rank)}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={u.name ?? u.tel} src={u.profile} size={28} />
                      <div>
                        <div className="text-xs font-semibold" style={{ color: '#fde68a' }}>
                          {u.name ?? <span style={{ color: '#64748b' }}>—</span>}
                        </div>
                        <div className="text-[10px]" style={{ color: '#64748b' }}>{u.id.slice(-8)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: '#a5b4fc' }}>{u.tel}</td>
                  <td className="px-3 py-2.5 text-right text-[10px]" style={{ color: '#64748b' }}>
                    {new Date(u.createdAt).toLocaleDateString('en-GB')}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs" style={{ color: '#f87171' }}>{fmt(u.totalBets)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-bold" style={{ color: rankColor(u.rank) }}>{fmt(u.balance)}</span>
                    <span className="ml-1 text-[10px]" style={{ color: '#64748b' }}>₭</span>
                  </td>
                </tr>
              ))}
              {ranked.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-xs" style={{ color: '#64748b' }}>{t('admin.competition.ranking.empty')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile ranking cards */}
      {!noCompetition && (
        <div className="flex flex-col gap-2 md:hidden">
          {ranked.map(u => (
            <div key={u.id} className="flex items-center gap-3 rounded-xl p-3"
              style={{ background: '#0f172a', border: `1px solid ${u.rank <= 3 ? rankColor(u.rank) + '40' : '#1e1b4b'}` }}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{ background: '#1e1b4b', color: rankColor(u.rank) }}>
                {u.rank <= 3 ? rankMedal(u.rank) : u.rank}
              </div>
              <Avatar name={u.name ?? u.tel} src={u.profile} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold" style={{ color: '#fde68a' }}>{u.name ?? '—'}</div>
                <div className="text-[10px]" style={{ color: '#818cf8' }}>{u.tel}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold" style={{ color: rankColor(u.rank) }}>{fmt(u.balance)} ₭</div>
                <div className="text-[10px]" style={{ color: '#64748b' }}>{t('admin.competition.ranking.betsShort', { amount: fmt(u.totalBets) })}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reset confirmation */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.8)' }} onClick={() => setShowResetConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#1e0040', border: '2px solid #ca8a04' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="mb-1 flex items-center gap-2 text-base font-bold" style={{ color: '#fbbf24' }}>
              <RotateCcw size={16} /> {t('admin.competition.resetConfirm.title')}
            </h2>
            <p className="mt-3 text-sm" style={{ color: '#e9d5ff' }}>
              {t('admin.competition.resetConfirm.body', { amount: '1,000,000' })}
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowResetConfirm(false)}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                style={{ background: '#2d1b4e', color: '#a78bfa', border: '1px solid #4c1d95' }}>{t('admin.competition.form.cancel')}</button>
              <resetFetcher.Form method="post" className="flex-1">
                <input type="hidden" name="op" value="resetAllDemo" />
                <button type="submit" disabled={resetFetcher.state !== 'idle'}
                  className="w-full rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#b45309,#78350f)', color: '#fff', border: '1px solid #fcd34d' }}>
                  {resetFetcher.state !== 'idle' ? t('admin.competition.resetConfirm.confirming') : t('admin.competition.resetConfirm.confirm')}
                </button>
              </resetFetcher.Form>
            </div>
          </div>
        </div>
      )}

      {/* End Competition confirmation */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.8)' }} onClick={() => setShowEndConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#1e0040', border: '2px solid #ef4444' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="mb-1 flex items-center gap-2 text-base font-bold" style={{ color: '#f87171' }}>
              <Flag size={16} /> {t('admin.competition.endConfirm.title')}
            </h2>
            <p className="mt-3 text-sm" style={{ color: '#e9d5ff' }}>
              {t('admin.competition.endConfirm.body', { saved: t('admin.competition.endConfirm.savedToHistory') })}
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowEndConfirm(false)}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                style={{ background: '#2d1b4e', color: '#a78bfa', border: '1px solid #4c1d95' }}>{t('admin.competition.form.cancel')}</button>
              <endFetcher.Form method="post" className="flex-1">
                <input type="hidden" name="op" value="endCompetition" />
                <button type="submit" disabled={endFetcher.state !== 'idle'}
                  className="w-full rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#7f1d1d,#450a0a)', color: '#fff', border: '1px solid #fca5a5' }}>
                  {endFetcher.state !== 'idle' ? t('admin.competition.endConfirm.confirming') : t('admin.competition.endConfirm.confirm')}
                </button>
              </endFetcher.Form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Avatar({ name, src, size }: { name: string; src: string | null; size: number }) {
  const [imgError, setImgError] = useState(false)
  const initials = name.slice(0, 2).toUpperCase()
  if (src && !imgError) {
    return <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }} onError={() => setImgError(true)} />
  }
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
      style={{ width: size, height: size, background: 'linear-gradient(135deg,#4338ca,#7c3aed)', color: '#fde68a' }}>
      {initials}
    </div>
  )
}
