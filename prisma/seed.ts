import { PrismaClient, Role, AccountStatus, WalletType } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import 'dotenv/config'

const prisma = new PrismaClient()

// Cost factor 10 is plenty for a demo; bump to 12 for production.
const BCRYPT_ROUNDS = 10

// 8-char alphanumeric (URL-safe). 36^8 ≈ 2.8e12 — collision risk negligible.
function generateReferralCode(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // ambiguous chars 0/O/I/L/1 omitted
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode()
    const existing = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } })
    if (!existing) return code
  }
  throw new Error('Could not generate a unique referral code after 5 attempts')
}

async function upsertAdmin() {
  const email = 'admin@pupatao.com'
  const passwordHash = await bcrypt.hash('admin1234', BCRYPT_ROUNDS)
  const admin = await prisma.admin.upsert({
    where: { email },
    update: {}, // don't overwrite an existing admin's password on re-seed
    create: {
      email,
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: Role.SUPERADMIN,
      status: AccountStatus.ACTIVE,
    },
  })
  console.log(`✓ admin (${admin.role}): ${admin.email}`)
  return admin
}

async function upsertDemoCustomer() {
  const tel = '+8562099999999'
  const passwordHash = await bcrypt.hash('test1234', BCRYPT_ROUNDS)
  // Try to fetch first so we can use an existing referralCode rather than
  // attempting to upsert with a fresh-but-not-unique value.
  const existing = await prisma.user.findUnique({ where: { tel } })
  const referralCode = existing?.referralCode ?? await generateUniqueReferralCode()
  const user = await prisma.user.upsert({
    where: { tel },
    update: {},
    create: {
      tel,
      passwordHash,
      firstName: 'Lucky',
      lastName: 'Player',
      role: Role.PLAYER,
      status: AccountStatus.ACTIVE,
      referralCode,
    },
  })
  console.log(`✓ user (${user.role}): ${user.tel}  ref=${user.referralCode}`)

  // Every user gets all three wallets. DEMO starts at 1M for testing; REAL
  // and PROMO start at 0. PROMO is funded only by first-topup admin approval.
  const demo = await prisma.wallet.upsert({
    where: { userId_type: { userId: user.id, type: WalletType.DEMO } },
    update: {},
    create: { userId: user.id, type: WalletType.DEMO, balance: 1_000_000 },
  })
  const real = await prisma.wallet.upsert({
    where: { userId_type: { userId: user.id, type: WalletType.REAL } },
    update: {},
    create: { userId: user.id, type: WalletType.REAL, balance: 0 },
  })
  const promo = await prisma.wallet.upsert({
    where: { userId_type: { userId: user.id, type: WalletType.PROMO } },
    update: {},
    create: { userId: user.id, type: WalletType.PROMO, balance: 0 },
  })
  console.log(`  ↳ wallet DEMO:  ${demo.balance.toLocaleString()} ₭`)
  console.log(`  ↳ wallet REAL:  ${real.balance.toLocaleString()} ₭`)
  console.log(`  ↳ wallet PROMO: ${promo.balance.toLocaleString()} ₭`)
  return user
}

// Backfill: every existing user must have a referralCode and a PROMO wallet.
// Safe to re-run — only fills gaps, never overwrites.
async function backfillExistingUsers() {
  const usersMissingCode = await prisma.user.findMany({
    where: { referralCode: { equals: '' } as unknown as string },  // empty-string check
    select: { id: true, referralCode: true, tel: true },
  })
  // (Older rows won't have the field at all — also handled below.)

  const allUsers = await prisma.user.findMany({ select: { id: true, referralCode: true, tel: true } })
  let backfilledCodes = 0
  for (const u of allUsers) {
    if (!u.referralCode) {
      const code = await generateUniqueReferralCode()
      await prisma.user.update({ where: { id: u.id }, data: { referralCode: code } })
      backfilledCodes++
    }
  }
  if (backfilledCodes > 0) console.log(`✓ backfilled referralCode on ${backfilledCodes} user(s)`)

  let backfilledPromo = 0
  for (const u of allUsers) {
    const promo = await prisma.wallet.findUnique({
      where: { userId_type: { userId: u.id, type: WalletType.PROMO } },
      select: { id: true },
    })
    if (!promo) {
      await prisma.wallet.create({ data: { userId: u.id, type: WalletType.PROMO, balance: 0 } })
      backfilledPromo++
    }
  }
  if (backfilledPromo > 0) console.log(`✓ backfilled PROMO wallet on ${backfilledPromo} user(s)`)

  // Suppress the unused-variable warning when usersMissingCode is empty.
  void usersMissingCode
}

async function main() {
  console.log('— seeding —')
  await upsertAdmin()
  await upsertDemoCustomer()
  await backfillExistingUsers()
  console.log('— done —')
}

main()
  .catch(e => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
