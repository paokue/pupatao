import { PrismaClient, Role, AccountStatus, WalletType } from '@prisma/client'
import bcrypt from 'bcryptjs'
import 'dotenv/config'

const prisma = new PrismaClient()

// Cost factor 10 is plenty for a demo; bump to 12 for production.
const BCRYPT_ROUNDS = 10

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
    },
  })
  console.log(`✓ user (${user.role}): ${user.tel}`)

  // Every user gets BOTH wallets. Demo starts at 1M for testing; Real starts at 0.
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
  console.log(`  ↳ wallet DEMO: ${demo.balance.toLocaleString()} ₭`)
  console.log(`  ↳ wallet REAL: ${real.balance.toLocaleString()} ₭`)
  return user
}

async function main() {
  console.log('— seeding —')
  await upsertAdmin()
  await upsertDemoCustomer()
  console.log('— done —')
}

main()
  .catch(e => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
