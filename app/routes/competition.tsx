import { useEffect, useState } from 'react'
import { redirect, useFetcher, useLoaderData, useRevalidator } from 'react-router'
import { ArrowLeft, LogIn, Trophy } from 'lucide-react'
import type { Route } from './+types/competition'
import {
  COMPETITION_CHANNEL,
  type CompetitionSummarizedPayload,
  type RankingUpdatedPayload,
} from '~/lib/pusher-channels'
import { usePusherEvent } from '~/hooks/use-pusher'
import type { CompetitionWinner } from '~/lib/system-settings.server'

export async function loader({ request }: Route.LoaderArgs) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  const { prisma } = await import('~/lib/prisma.server')
  const { getCompetitionConfig } = await import('~/lib/system-settings.server')

  const [user, competition, latestHistory] = await Promise.all([
    getCurrentUser(request).catch(() => null),
    getCompetitionConfig(),
    prisma.competitionHistory.findFirst({ orderBy: { createdAt: 'desc' } }),
  ])

  const accessible = competition.menuVisible || !!latestHistory
  if (!accessible) throw redirect('/')

  // Check if current user is a participant (for Type B/C)
  const needsJoin = competition.type !== 'DEMO_LIVE'
  let isParticipant = false
  let participantCount = 0
  if (needsJoin && competition.enabled) {
    const [participantRecord, count] = await Promise.all([
      user ? prisma.competitionParticipant.findUnique({ where: { userId: user.id } }) : null,
      prisma.competitionParticipant.count(),
    ])
    isParticipant = !!participantRecord
    participantCount = count
  }

  let ranked: (CompetitionWinner & { isMe: boolean; rank: number })[] = []
  if (competition.enabled) {
    const walletField = competition.type === 'DEMO_LIVE' ? 'DEMO' : 'REAL'
    const users = await prisma.user.findMany({
      select: {
        id: true, tel: true, firstName: true, lastName: true, profile: true,
        wallets: { where: { type: walletField }, select: { balance: true } },
      },
    })
    ranked = users
      .map(u => ({
        rank: 0, userId: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
        tel: u.tel, profile: u.profile as string | null,
        demoBalance: u.wallets[0]?.balance ?? 0,
        isMe: user?.id === u.id,
      }))
      .sort((a, b) => b.demoBalance - a.demoBalance)
      .map((u, i) => ({ ...u, rank: i + 1 }))
  }

  return {
    competition, ranked, userId: user?.id ?? null,
    needsJoin, isParticipant, participantCount,
    latestHistory: latestHistory
      ? {
          id: latestHistory.id, type: latestHistory.type,
          rules: latestHistory.rules,
          startDate: latestHistory.startDate?.toISOString() ?? null,
          endDate: latestHistory.endDate.toISOString(),
          winners: latestHistory.winners as unknown as CompetitionWinner[],
        }
      : null,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  const { prisma } = await import('~/lib/prisma.server')
  const { getCompetitionConfig } = await import('~/lib/system-settings.server')
  const { notifyCompetition } = await import('~/lib/pusher.server')

  const user = await getCurrentUser(request)
  if (!user) return { error: 'Not logged in.' }

  const fd = await request.formData()
  const op = String(fd.get('op') ?? '')

  if (op === 'joinCompetition') {
    const competition = await getCompetitionConfig()
    if (!competition.enabled) return { error: 'Competition is not active.' }
    if (competition.type === 'DEMO_LIVE') return { error: 'This competition does not require joining.' }

    await prisma.competitionParticipant.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    })
    const total = await prisma.competitionParticipant.count()
    notifyCompetition('competition:participantChanged', { totalParticipants: total })
    return { ok: true }
  }

  return { error: 'Unknown op' }
}

export default function CompetitionPage() {
  const {
    competition, ranked: initialRanked, latestHistory,
    needsJoin, isParticipant: initialIsParticipant, participantCount: initialCount,
  } = useLoaderData<typeof loader>()
  const revalidator = useRevalidator()
  const joinFetcher = useFetcher<{ ok?: boolean; error?: string }>()
  const [ranked, setRanked] = useState(initialRanked)
  const [summary, setSummary] = useState<CompetitionWinner[] | null>(competition.summary)
  const [isParticipant, setIsParticipant] = useState(initialIsParticipant)
  const [participantCount, setParticipantCount] = useState(initialCount)

  useEffect(() => { setRanked(initialRanked) }, [initialRanked])
  useEffect(() => { setSummary(competition.summary) }, [competition.summary])
  useEffect(() => { setIsParticipant(initialIsParticipant) }, [initialIsParticipant])
  useEffect(() => { setParticipantCount(initialCount) }, [initialCount])

  // After join succeeds, update local state immediately
  useEffect(() => {
    if (joinFetcher.state === 'idle' && joinFetcher.data?.ok) {
      setIsParticipant(true)
      setParticipantCount(c => c + 1)
      revalidator.revalidate()
    }
  }, [joinFetcher.state, joinFetcher.data])

  usePusherEvent<RankingUpdatedPayload>(COMPETITION_CHANNEL, 'ranking:updated', () => {
    if (competition.enabled) revalidator.revalidate()
  })
  usePusherEvent<CompetitionSummarizedPayload>(COMPETITION_CHANNEL, 'competition:summarized', payload => {
    setSummary(payload.winners as CompetitionWinner[])
  })

  function fmtGMT7(iso: string) {
    return new Date(iso).toLocaleString('lo-LA', {
      timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  }
  function fmt(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
  }
  const rankColor = (r: number) => r === 1 ? '#fbbf24' : r === 2 ? '#94a3b8' : r === 3 ? '#fb923c' : '#a5b4fc'
  const rankMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : null
  const myEntry = ranked.find(u => u.isMe)

  const showLive    = competition.enabled
  const showSummary = !competition.enabled && summary !== null
  const showHistory = !competition.enabled && summary === null && latestHistory !== null
  const isDemo      = competition.type === 'DEMO_LIVE'
  const typeLabel   = isDemo ? 'Demo Competition' : 'Real Competition'

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg,#1e0040,#0f0020)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{ background: '#1e0040', borderBottom: '1px solid #4c1d95' }}>
        <a href="/" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold"
          style={{ background: '#4c1d95', color: '#e9d5ff', border: '1px solid #7c3aed' }}>
          <ArrowLeft size={14} /> ກັບຄືນ
        </a>
        <div className="flex items-center gap-2">
          <Trophy size={18} style={{ color: '#fbbf24' }} />
          <h1 className="text-base font-bold" style={{ color: '#fbbf24' }}>
            {typeLabel}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {needsJoin && showLive && (
            <span className="text-[10px]" style={{ color: '#818cf8' }}>
              {participantCount} ຜູ້ເຂົ້າຮ່ວມ
            </span>
          )}
          {showLive && (
            <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(234,179,8,0.2)', color: '#fbbf24', border: '1px solid #ca8a04' }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
              LIVE
            </span>
          )}
          {showSummary && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid #16a34a' }}>
              ສຳເລັດ ✓
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-lg px-4 py-5 flex flex-col gap-4">

        {/* ── JOIN CARD (Type B/C only, when active) ── */}
        {showLive && needsJoin && (
          <div className="rounded-2xl p-4"
            style={{
              background: isParticipant ? 'rgba(22,163,74,0.08)' : 'rgba(234,179,8,0.08)',
              border: `2px solid ${isParticipant ? '#16a34a' : '#ca8a04'}`,
            }}>
            {isParticipant ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <div className="text-sm font-bold" style={{ color: '#4ade80' }}>ທ່ານໄດ້ເຂົ້າຮ່ວມການແຂ່ງຂັນແລ້ວ</div>
                  <div className="text-xs" style={{ color: '#6ee7b7' }}>
                    {competition.type === 'REAL_LIVE'
                      ? 'ຫ້າມຖອນໄລຍະການແຂ່ງຂັນ · ຫຼິ້ນ Live ດ້ວຍ Real ເທົ່ານັ້ນ'
                      : 'ຫ້າມຖອນໄລຍະການແຂ່ງຂັນ · ຫຼິ້ນໄດ້ທຸກ mode ດ້ວຍ Real'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold" style={{ color: '#fbbf24' }}>ເຂົ້າຮ່ວມການແຂ່ງຂັນ</div>
                  <div className="text-xs" style={{ color: '#a5b4fc' }}>
                    {competition.type === 'REAL_LIVE'
                      ? 'ໃຊ້ Real wallet ໃນ Live mode · ຫ້າມຖອນໄລຍະການແຂ່ງຂັນ'
                      : 'ໃຊ້ Real wallet ທຸກ mode · ຫ້າມຖອນໄລຍະການແຂ່ງຂັນ'}
                  </div>
                </div>
                <joinFetcher.Form method="post">
                  <input type="hidden" name="op" value="joinCompetition" />
                  <button type="submit" disabled={joinFetcher.state !== 'idle'}
                    className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 shrink-0"
                    style={{ background: 'linear-gradient(135deg,#ca8a04,#78350f)', color: '#fff', border: '1px solid #fbbf24' }}>
                    <LogIn size={14} />
                    {joinFetcher.state !== 'idle' ? 'ກຳລັງດຳເນີນ…' : 'ເຂົ້າຮ່ວມ'}
                  </button>
                </joinFetcher.Form>
              </div>
            )}
            {joinFetcher.data?.error && (
              <div className="mt-2 text-xs" style={{ color: '#f87171' }}>{joinFetcher.data.error}</div>
            )}
          </div>
        )}

        {/* ── LIVE MODE ── */}
        {showLive && (
          <>
            <div className="rounded-2xl p-4" style={{ background: 'rgba(76,29,149,0.3)', border: '1px solid #4c1d95' }}>
              <div className="flex items-center gap-2 mb-3">
                <Trophy size={16} style={{ color: '#fbbf24' }} />
                <span className="text-sm font-bold" style={{ color: '#fbbf24' }}>ກົດລະບຽບ</span>
              </div>
              {(competition.start || competition.end) && (
                <div className="mb-3 flex flex-wrap gap-4 text-xs" style={{ color: '#c4b5fd' }}>
                  {competition.start && <div><span style={{ color: '#818cf8' }}>ເລີ່ມ: </span><span className="font-semibold">{fmtGMT7(competition.start)}</span></div>}
                  {competition.end   && <div><span style={{ color: '#818cf8' }}>ສິ້ນສຸດ: </span><span className="font-semibold">{fmtGMT7(competition.end)}</span></div>}
                </div>
              )}
              <p className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: '#e9d5ff' }}>
                {competition.rules ?? (isDemo ? 'ແຂ່ງຂັນດ້ວຍ Demo Balance — ຜູ້ທີ່ມີ Demo ສູງສຸດຊະນະ!' : 'ແຂ່ງຂັນດ້ວຍ Real Balance — ຜູ້ທີ່ມີ Real ສູງສຸດຊະນະ!')}
              </p>
            </div>

            {myEntry && (
              <div className="rounded-2xl p-4" style={{ background: 'rgba(234,179,8,0.1)', border: '2px solid #ca8a04' }}>
                <div className="text-[10px] font-bold mb-2" style={{ color: '#fbbf24' }}>ຕຳແໜ່ງຂອງທ່ານ</div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold"
                    style={{ background: 'rgba(234,179,8,0.2)', color: '#fbbf24' }}>
                    {rankMedal(myEntry.rank) ?? `#${myEntry.rank}`}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold" style={{ color: '#fbbf24' }}>ອັນດັບ #{myEntry.rank} ຈາກ {ranked.length}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold" style={{ color: '#fbbf24' }}>{fmt(myEntry.demoBalance)} ₭</div>
                    <div className="text-[10px]" style={{ color: '#ca8a04' }}>{isDemo ? 'Demo' : 'Real'} Balance</div>
                  </div>
                </div>
              </div>
            )}

            <RankingList ranked={ranked} fmt={fmt} rankColor={rankColor} rankMedal={rankMedal} />
          </>
        )}

        {/* ── SUMMARY / HISTORY ── */}
        {showSummary && summary && (
          <>
            <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(234,179,8,0.08)', border: '2px solid #ca8a04' }}>
              <div className="text-lg font-bold" style={{ color: '#fbbf24' }}>🏆 ຜົນການແຂ່ງຂັນ</div>
              {(competition.start || competition.end) && (
                <div className="mt-1 text-xs" style={{ color: '#a5b4fc' }}>
                  {competition.start ? fmtGMT7(competition.start) : '?'} — {competition.end ? fmtGMT7(competition.end) : '?'}
                </div>
              )}
              {competition.rules && <p className="mt-2 text-xs" style={{ color: '#c4b5fd' }}>{competition.rules}</p>}
            </div>
            <Top3Podium winners={summary} fmt={fmt} rankColor={rankColor} />
          </>
        )}

        {showHistory && latestHistory && (
          <>
            <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(76,29,149,0.2)', border: '1px solid #4c1d95' }}>
              <div className="text-base font-bold" style={{ color: '#fbbf24' }}>🏆 ຜົນການແຂ່ງຂັນຄັ້ງຜ່ານມາ</div>
              <div className="mt-1 text-xs" style={{ color: '#a5b4fc' }}>
                {latestHistory.startDate ? fmtGMT7(latestHistory.startDate) : '?'} — {fmtGMT7(latestHistory.endDate)}
              </div>
              {latestHistory.rules && <p className="mt-2 text-xs" style={{ color: '#c4b5fd' }}>{latestHistory.rules}</p>}
            </div>
            {latestHistory.winners.length > 0 && (
              <Top3Podium winners={latestHistory.winners} fmt={fmt} rankColor={rankColor} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function RankingList({ ranked, fmt, rankColor, rankMedal }: {
  ranked: (CompetitionWinner & { isMe: boolean; rank: number })[]
  fmt: (n: number) => string
  rankColor: (r: number) => string
  rankMedal: (r: number) => string | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-bold" style={{ color: '#a5b4fc' }}>ຄະແນນທັງໝົດ ({ranked.length} ຄົນ)</div>
      {ranked.map(u => (
        <div key={u.userId} className="flex items-center gap-3 rounded-xl p-3 transition-all"
          style={{
            background: u.isMe ? 'rgba(234,179,8,0.12)' : 'rgba(76,29,149,0.15)',
            border: `1px solid ${u.isMe ? '#ca8a04' : u.rank <= 3 ? rankColor(u.rank) + '30' : '#2d1b4e'}`,
          }}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
            style={{ background: 'rgba(0,0,0,0.3)', color: rankColor(u.rank) }}>
            {rankMedal(u.rank) ?? u.rank}
          </div>
          <Avatar name={u.name ?? u.tel} src={u.profile} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" style={{ color: u.isMe ? '#fbbf24' : '#fde68a' }}>
              {u.name ?? u.tel}
              {u.isMe && <span className="ml-1.5 text-[10px] font-bold" style={{ color: '#fbbf24' }}>(ທ່ານ)</span>}
            </div>
            <div className="text-[10px]" style={{ color: '#818cf8' }}>{u.tel}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-bold" style={{ color: rankColor(u.rank) }}>{fmt(u.demoBalance)} ₭</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Top3Podium({ winners, fmt, rankColor }: {
  winners: CompetitionWinner[]
  fmt: (n: number) => string
  rankColor: (r: number) => string
}) {
  const medals = ['🥇', '🥈', '🥉']
  const sorted = [...winners].sort((a, b) => a.rank - b.rank)
  const ordered = [1, 0, 2].map(i => sorted[i]).filter(Boolean)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-center gap-3">
        {ordered.map(w => {
          const heights = { 1: 'h-32', 2: 'h-24', 3: 'h-20' }
          const h = heights[w.rank as 1|2|3] ?? 'h-20'
          return (
            <div key={w.userId} className="flex flex-1 flex-col items-center gap-2 max-w-[120px]">
              <Avatar name={w.name ?? w.tel} src={w.profile} size={48} />
              <div className="text-center">
                <div className="text-xs font-bold truncate" style={{ color: rankColor(w.rank) }}>{w.name ?? w.tel}</div>
                <div className="text-[10px]" style={{ color: '#818cf8' }}>{w.tel}</div>
                <div className="mt-0.5 text-sm font-bold" style={{ color: rankColor(w.rank) }}>{fmt(w.demoBalance)} ₭</div>
              </div>
              <div className={`w-full ${h} flex items-center justify-center rounded-t-lg`}
                style={{ background: `${rankColor(w.rank)}20`, border: `2px solid ${rankColor(w.rank)}40` }}>
                <span style={{ fontSize: 28 }}>{medals[w.rank - 1]}</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-col gap-2">
        {sorted.map(w => (
          <div key={w.userId} className="flex items-center gap-3 rounded-xl p-3"
            style={{ background: 'rgba(76,29,149,0.15)', border: `1px solid ${rankColor(w.rank)}30` }}>
            <span style={{ fontSize: 20, minWidth: 28, textAlign: 'center' }}>{medals[w.rank - 1]}</span>
            <Avatar name={w.name ?? w.tel} src={w.profile} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold" style={{ color: '#fde68a' }}>{w.name ?? w.tel}</div>
              <div className="text-[10px]" style={{ color: '#818cf8' }}>{w.tel}</div>
            </div>
            <div className="text-right font-bold" style={{ color: rankColor(w.rank) }}>{fmt(w.demoBalance)} ₭</div>
          </div>
        ))}
      </div>
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
    <div className="flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{ width: size, height: size, background: 'linear-gradient(135deg,#4338ca,#7c3aed)', color: '#fde68a' }}>
      {initials}
    </div>
  )
}
