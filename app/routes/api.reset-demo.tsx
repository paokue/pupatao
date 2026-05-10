import type { Route } from './+types/api.reset-demo'
import { prisma } from '~/lib/prisma.server'

// Customer-triggered reset of the DEMO wallet to the starting amount.
// Persisted in the DB so it survives logout/login — supports the upcoming
// "demo competition" where top-3 standings need a real, audited balance.
const DEMO_START_AMOUNT = 1_000_000

export async function action({ request }: Route.ActionArgs) {
  const { getCurrentUser } = await import('~/lib/auth.server')
  const user = await getCurrentUser(request)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId_type: { userId: user.id, type: 'DEMO' } },
    })
    if (!wallet) return Response.json({ error: 'Demo wallet not found' }, { status: 404 })

    const balanceBefore = wallet.balance

    await prisma.$transaction(async db => {
      await db.wallet.update({
        where: { id: wallet.id },
        data: { balance: DEMO_START_AMOUNT, version: { increment: 1 } },
      })
      await db.transaction.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          type: 'DEMO_RESET',
          amount: DEMO_START_AMOUNT,
          balanceBefore,
          balanceAfter: DEMO_START_AMOUNT,
          status: 'COMPLETED',
          idempotencyKey: crypto.randomUUID(),
          note: 'Demo balance reset by user',
        },
      })
    })

    return Response.json({ ok: true, balance: DEMO_START_AMOUNT })
  } catch (err) {
    console.error('[api/reset-demo]', err)
    return Response.json({ error: 'Failed to reset demo balance.' }, { status: 500 })
  }
}

export function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}
