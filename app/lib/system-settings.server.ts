// Global system settings stored in MongoDB via the SystemSetting model.
// Each setting is a key/value pair. Values are always strings; callers
// convert to the correct type.
//
// Current settings:
//   sleepMode — 'true' | 'false'
//     When true, ALL REAL/PROMO self-play rolls are forced to 0 payout.
//     DEMO wallets and LIVE mode are unaffected.
//   liveStreamUrl — URL string (absent = no active live stream)
//     The stream URL currently shown to customers. Set when admin starts a
//     round or updates the stream; cleared when admin clicks "End Live".
//   liveScheduleStart — ISO UTC string (absent = no schedule)
//   liveScheduleEnd   — ISO UTC string (absent = no schedule)
//     Start/end of the next scheduled live broadcast in UTC. Display in GMT+7.

import { prisma } from './prisma.server'

export const SLEEP_MODE_KEY              = 'sleepMode'
export const COMPETITION_ENABLED_KEY     = 'competitionEnabled'
export const COMPETITION_RULES_KEY       = 'competitionRules'
export const COMPETITION_START_KEY       = 'competitionStart'
export const COMPETITION_END_KEY         = 'competitionEnd'
export const COMPETITION_SUMMARY_KEY     = 'competitionSummary'
export const COMPETITION_TYPE_KEY        = 'competitionType'
export const COMPETITION_STARTED_KEY     = 'competitionWasStarted'

// DEMO_LIVE  — ranks by DEMO balance; DEMO hidden from self-play
// REAL_LIVE  — ranks by REAL balance; REAL hidden from self-play (live-only competition)
// REAL_ALL   — ranks by REAL balance; no self-play restrictions
export type CompetitionType = 'DEMO_LIVE' | 'REAL_LIVE' | 'REAL_ALL'

export interface CompetitionWinner {
  rank: number
  userId: string
  name: string | null
  tel: string
  profile: string | null
  demoBalance: number
}
export const LIVE_STREAM_URL_KEY        = 'liveStreamUrl'
export const LIVE_SCHEDULE_START_KEY    = 'liveScheduleStart'
export const LIVE_SCHEDULE_END_KEY      = 'liveScheduleEnd'
export const LIVE_SCHEDULE_NOTICE_KEY   = 'liveScheduleNotice'
export const LIVE_BETTING_SECONDS_KEY   = 'liveBettingSeconds'

export async function getSleepMode(): Promise<boolean> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SLEEP_MODE_KEY },
      select: { value: true },
    })
    return setting?.value === 'true'
  } catch {
    return false // fail open — don't break the game if DB is slow
  }
}

export async function setSleepMode(active: boolean, adminId: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SLEEP_MODE_KEY },
    create: { key: SLEEP_MODE_KEY, value: String(active), updatedBy: adminId },
    update: { value: String(active), updatedBy: adminId },
  })
}

export async function getLiveStreamUrl(): Promise<string | null> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: LIVE_STREAM_URL_KEY },
      select: { value: true },
    })
    return setting?.value ?? null
  } catch {
    return null
  }
}

export async function setLiveStreamUrl(url: string | null, adminId: string): Promise<void> {
  if (url === null) {
    await prisma.systemSetting.deleteMany({ where: { key: LIVE_STREAM_URL_KEY } })
  } else {
    await prisma.systemSetting.upsert({
      where: { key: LIVE_STREAM_URL_KEY },
      create: { key: LIVE_STREAM_URL_KEY, value: url, updatedBy: adminId },
      update: { value: url, updatedBy: adminId },
    })
  }
}

export async function getLiveSchedule(): Promise<{ start: string | null; end: string | null; notice: string | null }> {
  try {
    const [startSetting, endSetting, noticeSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: LIVE_SCHEDULE_START_KEY }, select: { value: true } }),
      prisma.systemSetting.findUnique({ where: { key: LIVE_SCHEDULE_END_KEY }, select: { value: true } }),
      prisma.systemSetting.findUnique({ where: { key: LIVE_SCHEDULE_NOTICE_KEY }, select: { value: true } }),
    ])
    return {
      start:  startSetting?.value  ?? null,
      end:    endSetting?.value    ?? null,
      notice: noticeSetting?.value ?? null,
    }
  } catch {
    return { start: null, end: null, notice: null }
  }
}

export async function setLiveSchedule(
  start: string | null,
  end: string | null,
  adminId: string,
  notice?: string | null,
): Promise<void> {
  const upsertOrDelete = (key: string, value: string | null) =>
    value
      ? prisma.systemSetting.upsert({
          where: { key },
          create: { key, value, updatedBy: adminId },
          update: { value, updatedBy: adminId },
        })
      : prisma.systemSetting.deleteMany({ where: { key } })

  await Promise.all([
    upsertOrDelete(LIVE_SCHEDULE_START_KEY, start),
    upsertOrDelete(LIVE_SCHEDULE_END_KEY, end),
    upsertOrDelete(LIVE_SCHEDULE_NOTICE_KEY, notice ?? null),
  ])
}

// ─── Competition ─────────────────────────────────────────────────────────────

export async function getCompetitionEnabled(): Promise<boolean> {
  try {
    const s = await prisma.systemSetting.findUnique({ where: { key: COMPETITION_ENABLED_KEY }, select: { value: true } })
    return s?.value === 'true'
  } catch { return false }
}

export async function setCompetitionEnabled(active: boolean, adminId: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: COMPETITION_ENABLED_KEY },
    create: { key: COMPETITION_ENABLED_KEY, value: String(active), updatedBy: adminId },
    update: { value: String(active), updatedBy: adminId },
  })
}

export interface CompetitionConfig {
  enabled: boolean
  type: CompetitionType      // which wallet + which modes
  rules: string | null
  start: string | null       // ISO UTC
  end:   string | null       // ISO UTC
  summary: CompetitionWinner[] | null  // top-3 snapshot, null if not yet summarized
  menuVisible: boolean       // show Competition in user menu: enabled OR summary set
  hasConfig: boolean         // type/rules/dates have been saved (not a blank slate)
  wasStarted: boolean        // true once admin has clicked Start at least once
}

export async function getCompetitionConfig(): Promise<CompetitionConfig> {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            COMPETITION_ENABLED_KEY, COMPETITION_TYPE_KEY,
            COMPETITION_RULES_KEY,   COMPETITION_START_KEY,
            COMPETITION_END_KEY,     COMPETITION_SUMMARY_KEY,
            COMPETITION_STARTED_KEY,
          ],
        },
      },
      select: { key: true, value: true },
    })
    const m = new Map(settings.map(s => [s.key, s.value]))
    const enabled = m.get(COMPETITION_ENABLED_KEY) === 'true'
    const rawType = m.get(COMPETITION_TYPE_KEY)
    const type: CompetitionType =
      rawType === 'REAL_LIVE' ? 'REAL_LIVE'
      : rawType === 'REAL_ALL' ? 'REAL_ALL'
      : 'DEMO_LIVE'
    let summary: CompetitionWinner[] | null = null
    const summaryStr = m.get(COMPETITION_SUMMARY_KEY)
    if (summaryStr) {
      try { summary = JSON.parse(summaryStr) as CompetitionWinner[] } catch { summary = null }
    }
    const hasConfig = m.has(COMPETITION_TYPE_KEY) || m.has(COMPETITION_RULES_KEY)
      || m.has(COMPETITION_START_KEY) || m.has(COMPETITION_END_KEY)
    const wasStarted = m.get(COMPETITION_STARTED_KEY) === 'true'
    return {
      enabled, type,
      rules:   m.get(COMPETITION_RULES_KEY) ?? null,
      start:   m.get(COMPETITION_START_KEY) ?? null,
      end:     m.get(COMPETITION_END_KEY)   ?? null,
      summary,
      menuVisible: enabled || summary !== null,
      hasConfig,
      wasStarted,
    }
  } catch {
    return {
      enabled: false, type: 'DEMO_LIVE', rules: null, start: null, end: null,
      summary: null, menuVisible: false, hasConfig: false, wasStarted: false,
    }
  }
}

export async function setCompetitionSummary(
  winners: CompetitionWinner[] | null,
  adminId: string,
): Promise<void> {
  if (winners === null) {
    await prisma.systemSetting.deleteMany({ where: { key: COMPETITION_SUMMARY_KEY } })
  } else {
    const value = JSON.stringify(winners)
    await prisma.systemSetting.upsert({
      where: { key: COMPETITION_SUMMARY_KEY },
      create: { key: COMPETITION_SUMMARY_KEY, value, updatedBy: adminId },
      update: { value, updatedBy: adminId },
    })
  }
}

export async function setCompetitionConfig(
  config: { type?: CompetitionType; rules: string | null; start: string | null; end: string | null },
  adminId: string,
): Promise<void> {
  const upsert = (key: string, value: string | null) =>
    value
      ? prisma.systemSetting.upsert({
          where: { key },
          create: { key, value, updatedBy: adminId },
          update: { value, updatedBy: adminId },
        })
      : prisma.systemSetting.deleteMany({ where: { key } })

  await Promise.all([
    config.type
      ? prisma.systemSetting.upsert({
          where: { key: COMPETITION_TYPE_KEY },
          create: { key: COMPETITION_TYPE_KEY, value: config.type, updatedBy: adminId },
          update: { value: config.type, updatedBy: adminId },
        })
      : Promise.resolve(),
    upsert(COMPETITION_RULES_KEY, config.rules),
    upsert(COMPETITION_START_KEY, config.start),
    upsert(COMPETITION_END_KEY,   config.end),
  ])
}
