import { useLoaderData } from 'react-router'
import { ArrowLeft, Trophy } from 'lucide-react'
import type { Route } from './+types/admin.competition.$id'
import { requireAdmin } from '~/lib/admin-auth.server'
import { prisma } from '~/lib/prisma.server'
import type { CompetitionWinner } from '~/lib/system-settings.server'
import { useT } from '~/lib/use-t'
import { t as translate, parseLocaleCookie } from '~/lib/i18n'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)
  const locale = parseLocaleCookie(request.headers.get('cookie'))
  const id = params.id
  if (!id) throw new Response(translate(locale, 'admin.competition.detail.notFound'), { status: 404 })

  const record = await prisma.competitionHistory.findUnique({ where: { id } })
  if (!record) throw new Response(translate(locale, 'admin.competition.detail.competitionNotFound'), { status: 404 })

  // Resolve admin names for configured/started/ended by
  const adminIds = [record.configuredBy, record.startedBy, record.endedBy].filter(Boolean) as string[]
  const admins = adminIds.length > 0
    ? await prisma.admin.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : []
  function adminName(aid: string | null) {
    if (!aid) return null
    const a = admins.find(x => x.id === aid)
    if (!a) return null
    return [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email
  }

  return {
    id: record.id,
    type: record.type,
    rules: record.rules,
    startDate: record.startDate?.toISOString() ?? null,
    endDate: record.endDate.toISOString(),
    totalParticipants: record.totalParticipants,
    createdAt: record.createdAt.toISOString(),
    winners: record.winners as unknown as CompetitionWinner[],
    configuredBy: adminName(record.configuredBy ?? null),
    startedBy:    adminName(record.startedBy    ?? null),
    endedBy:      adminName(record.endedBy      ?? null),
  }
}

export default function AdminCompetitionDetail() {
  const t = useT()
  const record = useLoaderData<typeof loader>()

  function fmtGMT7(iso: string) {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  }
  function fmt(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
  }

  const typeLabel = record.type === 'DEMO_LIVE' ? t('admin.competition.type.demoLive.label')
    : record.type === 'REAL_LIVE' ? t('admin.competition.type.realLive.label')
    : t('admin.competition.type.realAll.label')
  const typeColor = record.type === 'DEMO_LIVE' ? '#a5b4fc' : '#fbbf24'
  const rankColor = (r: number) => r === 1 ? '#fbbf24' : r === 2 ? '#94a3b8' : r === 3 ? '#fb923c' : '#a5b4fc'
  const medals = ['🥇', '🥈', '🥉']
  const sorted = [...record.winners].sort((a, b) => a.rank - b.rank)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <a href="/admin/competition"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold"
          style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
          <ArrowLeft size={12} /> {t('admin.competition.detail.back')}
        </a>
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: '#fbbf24' }}>
          <Trophy size={20} /> {t('admin.competition.detail.title')}
        </h1>
      </div>

      {/* Meta */}
      <div className="rounded-xl p-4" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.history.col.type')}</div>
            <div className="mt-0.5 text-xs font-bold" style={{ color: typeColor }}>{typeLabel}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.detail.meta.start')}</div>
            <div className="mt-0.5 text-xs" style={{ color: '#fde68a' }}>{record.startDate ? fmtGMT7(record.startDate) : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.detail.meta.end')}</div>
            <div className="mt-0.5 text-xs" style={{ color: '#fde68a' }}>{fmtGMT7(record.endDate)}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.detail.meta.totalParticipants')}</div>
            <div className="mt-0.5 text-sm font-bold" style={{ color: '#4ade80' }}>{record.totalParticipants.toLocaleString()}</div>
          </div>
        </div>
        {record.rules && (
          <div className="mt-4 rounded-lg px-3 py-2.5 text-xs" style={{ background: '#1e1b4b', color: '#c4b5fd' }}>
            {record.rules}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{ background: 'rgba(22,163,74,0.15)', color: '#4ade80', border: '1px solid #16a34a' }}>
            {t('admin.competition.history.completed')}
          </span>
          <span className="text-[10px]" style={{ color: '#64748b' }}>
            {t('admin.competition.detail.archivedOn', { date: fmtGMT7(record.createdAt) })}
          </span>
        </div>

        {/* Admin trail */}
        {(record.configuredBy || record.startedBy || record.endedBy) && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3" style={{ borderColor: '#1e1b4b' }}>
            {record.configuredBy && (
              <div>
                <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.detail.trail.configuredBy')}</div>
                <div className="mt-0.5 text-xs font-semibold" style={{ color: '#fde68a' }}>{record.configuredBy}</div>
              </div>
            )}
            {record.startedBy && (
              <div>
                <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.detail.trail.startedBy')}</div>
                <div className="mt-0.5 text-xs font-semibold" style={{ color: '#4ade80' }}>{record.startedBy}</div>
              </div>
            )}
            {record.endedBy && (
              <div>
                <div className="text-[10px] font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.detail.trail.endedBy')}</div>
                <div className="mt-0.5 text-xs font-semibold" style={{ color: '#f87171' }}>{record.endedBy}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Winners podium */}
      {sorted.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-bold" style={{ color: '#a5b4fc' }}>{t('admin.competition.detail.winners.heading')}</div>

          {/* Podium */}
          <div className="flex items-end justify-center gap-4">
            {[1, 0, 2].map(idx => {
              const w = sorted[idx]
              if (!w) return null
              const heights = ['h-28', 'h-20', 'h-16']
              return (
                <div key={w.userId} className="flex flex-col items-center gap-2 flex-1 max-w-[140px]">
                  <WinnerAvatar name={w.name ?? w.tel} src={w.profile} size={52} />
                  <div className="text-center">
                    <div className="text-xs font-bold truncate" style={{ color: rankColor(w.rank) }}>
                      {w.name ?? w.tel}
                    </div>
                    <div className="text-[10px]" style={{ color: '#818cf8' }}>{w.tel}</div>
                    <div className="mt-0.5 font-bold" style={{ color: rankColor(w.rank) }}>
                      {fmt(w.demoBalance)} ₭
                    </div>
                  </div>
                  <div className={`w-full ${heights[idx]} flex items-center justify-center rounded-t-lg`}
                    style={{ background: `${rankColor(w.rank)}20`, border: `2px solid ${rankColor(w.rank)}40` }}>
                    <span style={{ fontSize: 28 }}>{medals[w.rank - 1]}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* List */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#0f172a', border: '1px solid #1e1b4b' }}>
            {sorted.map(w => (
              <div key={w.userId} className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: w.rank > 1 ? '1px solid #1e1b4b' : 'none' }}>
                <span style={{ fontSize: 20, minWidth: 28, textAlign: 'center' }}>{medals[w.rank - 1]}</span>
                <WinnerAvatar name={w.name ?? w.tel} src={w.profile} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold" style={{ color: '#fde68a' }}>{w.name ?? '—'}</div>
                  <div className="text-[10px]" style={{ color: '#818cf8' }}>{w.tel}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold" style={{ color: rankColor(w.rank) }}>{fmt(w.demoBalance)} ₭</div>
                  <div className="text-[10px]" style={{ color: '#64748b' }}>{t('admin.competition.detail.winners.rank', { n: w.rank })}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-6 text-center text-xs" style={{ background: '#0f172a', color: '#64748b', border: '1px solid #1e1b4b' }}>
          {t('admin.competition.detail.winners.empty')}
        </div>
      )}
    </div>
  )
}

function WinnerAvatar({ name, src, size }: { name: string; src: string | null; size: number }) {
  const initials = name.slice(0, 2).toUpperCase()
  if (src) {
    return <img src={src} alt={name} width={size} height={size}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }} />
  }
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{ width: size, height: size, background: 'linear-gradient(135deg,#4338ca,#7c3aed)', color: '#fde68a' }}>
      {initials}
    </div>
  )
}
