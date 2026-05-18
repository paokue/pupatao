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

export const SLEEP_MODE_KEY         = 'sleepMode'
export const LIVE_STREAM_URL_KEY    = 'liveStreamUrl'
export const LIVE_SCHEDULE_START_KEY = 'liveScheduleStart'
export const LIVE_SCHEDULE_END_KEY   = 'liveScheduleEnd'

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

export async function getLiveSchedule(): Promise<{ start: string | null; end: string | null }> {
  try {
    const [startSetting, endSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: LIVE_SCHEDULE_START_KEY }, select: { value: true } }),
      prisma.systemSetting.findUnique({ where: { key: LIVE_SCHEDULE_END_KEY }, select: { value: true } }),
    ])
    return {
      start: startSetting?.value ?? null,
      end:   endSetting?.value   ?? null,
    }
  } catch {
    return { start: null, end: null }
  }
}

export async function setLiveSchedule(
  start: string | null,
  end: string | null,
  adminId: string,
): Promise<void> {
  await Promise.all([
    start
      ? prisma.systemSetting.upsert({
          where: { key: LIVE_SCHEDULE_START_KEY },
          create: { key: LIVE_SCHEDULE_START_KEY, value: start, updatedBy: adminId },
          update: { value: start, updatedBy: adminId },
        })
      : prisma.systemSetting.deleteMany({ where: { key: LIVE_SCHEDULE_START_KEY } }),
    end
      ? prisma.systemSetting.upsert({
          where: { key: LIVE_SCHEDULE_END_KEY },
          create: { key: LIVE_SCHEDULE_END_KEY, value: end, updatedBy: adminId },
          update: { value: end, updatedBy: adminId },
        })
      : prisma.systemSetting.deleteMany({ where: { key: LIVE_SCHEDULE_END_KEY } }),
  ])
}
