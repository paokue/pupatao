// Lightweight endpoint whose only purpose is to wake the serverless function
// and establish the MongoDB connection pool BEFORE the user clicks roll.
// Called fire-and-forget when the player places their first chip.
import { prisma } from '~/lib/prisma.server'

export async function loader() {
  await prisma.$runCommandRaw({ ping: 1 })
  return Response.json({ ok: true })
}

export function action() {
  return new Response('Method Not Allowed', { status: 405 })
}
