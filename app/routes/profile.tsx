import { useEffect, useRef, useState } from 'react'
import {
  Form,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useActionData,
} from 'react-router'
import type { Route } from './+types/profile'
import { ArrowLeft, Camera, Loader, Phone, Save, Upload, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { requireUser } from '~/lib/auth.server'
import { prisma } from '~/lib/prisma.server'
import { playClick } from '~/hooks/use-sound-engine'
import { useT } from '~/lib/use-t'
import { LanguageSwitch } from '~/components/LanguageSwitch'

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — return the full authenticated user profile (sans password hash).
// ─────────────────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const bank = await prisma.bank.findUnique({
    where: { userId: user.id },
    select: { qrUrl: true },
  })
  return {
    user: {
      id: user.id,
      tel: user.tel,
      firstName: user.firstName,
      lastName: user.lastName,
      profile: user.profile,
      dob: user.dob ? user.dob.toISOString().slice(0, 10) : '',
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    },
    bankQrUrl: bank?.qrUrl ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — update firstName / lastName / dob / profile. tel is immutable here.
// ─────────────────────────────────────────────────────────────────────────────

const NAME_MAX = 60
const MAX_AGE_YEARS = 120

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const form = await request.formData()

  const firstName = (form.get('firstName') as string | null)?.trim() || null
  const lastName = (form.get('lastName') as string | null)?.trim() || null
  const dobRaw = (form.get('dob') as string | null)?.trim() || ''
  const profile = (form.get('profile') as string | null)?.trim() || null

  // Field-level validation.
  if (firstName && firstName.length > NAME_MAX) return { error: `First name too long (max ${NAME_MAX}).` }
  if (lastName && lastName.length > NAME_MAX) return { error: `Last name too long (max ${NAME_MAX}).` }

  let dob: Date | null = null
  if (dobRaw) {
    const parsed = new Date(dobRaw + 'T00:00:00Z')
    if (Number.isNaN(parsed.getTime())) return { error: 'Invalid date of birth.' }
    const now = Date.now()
    const minBirth = now - MAX_AGE_YEARS * 365.25 * 86_400_000
    if (parsed.getTime() > now) return { error: 'Date of birth cannot be in the future.' }
    if (parsed.getTime() < minBirth) return { error: `Date of birth cannot be before ${MAX_AGE_YEARS} years ago.` }
    dob = parsed
  }

  if (profile && profile.length > 512) return { error: 'Profile image URL too long.' }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { firstName, lastName, dob, profile },
    })
    return { ok: true }
  } catch (err) {
    console.error('[profile update]', err)
    const isConn =
      err instanceof Error &&
      /Server selection timeout|No available servers|received fatal alert|ECONNREFUSED|ENOTFOUND/i.test(err.message)
    return {
      error: isConn
        ? 'Cannot reach the database. Check your connection and try again.'
        : 'Failed to save. Please try again.',
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

type AvatarResponse = { url?: string; path?: string; error?: string }
type BankQrResponse = { url?: string; qrUrl?: string; error?: string }

export default function ProfilePage() {
  const { user, bankQrUrl } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const avatarFetcher = useFetcher<AvatarResponse>()
  const t = useT()

  const saving = navigation.state === 'submitting'
  const uploading = avatarFetcher.state !== 'idle'

  // Bank QR state — separate fetcher so it doesn't collide with the avatar
  // upload or the profile-save form. `currentBankQr` mirrors the server value
  // and is overwritten as soon as a fresh upload returns a URL.
  const bankQrFetcher = useFetcher<BankQrResponse>()
  const bankUploading = bankQrFetcher.state !== 'idle'
  const [currentBankQr, setCurrentBankQr] = useState<string | null>(bankQrUrl)
  const [bankLocalPreview, setBankLocalPreview] = useState<string | null>(null)
  const [bankUploadError, setBankUploadError] = useState<string | null>(null)
  const [bankLightbox, setBankLightbox] = useState<string | null>(null)
  const bankFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCurrentBankQr(bankQrUrl)
  }, [bankQrUrl])

  useEffect(() => {
    if (bankQrFetcher.state !== 'idle' || !bankQrFetcher.data) return
    if (bankQrFetcher.data.error) {
      setBankUploadError(bankQrFetcher.data.error)
      setBankLocalPreview(null)
      return
    }
    const url = bankQrFetcher.data.qrUrl ?? bankQrFetcher.data.url
    if (url) {
      setCurrentBankQr(url)
      setBankLocalPreview(null)
      setBankUploadError(null)
      toast.success(t('profile.bankQrUpdated'), { description: t('profile.bankQrUpdatedDesc') })
    }
  }, [bankQrFetcher.state, bankQrFetcher.data, t])

  useEffect(() => {
    return () => {
      if (bankLocalPreview) URL.revokeObjectURL(bankLocalPreview)
    }
  }, [bankLocalPreview])

  function onPickBankQr(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBankUploadError(null)
    const preview = URL.createObjectURL(file)
    setBankLocalPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return preview
    })
    const fd = new FormData()
    fd.append('file', file)
    bankQrFetcher.submit(fd, {
      method: 'post',
      action: '/api/bank-qr',
      encType: 'multipart/form-data',
    })
    e.target.value = ''
  }

  const displayedBankQr = bankLocalPreview || currentBankQr || null

  // Success toast when the save action comes back with ok:true. Keyed on the
  // reference so a repeat submit with the same data still fires.
  useEffect(() => {
    if (actionData && 'ok' in actionData && actionData.ok) {
      toast.success(t('profile.profileUpdated'), {
        description: t('profile.profileUpdatedDesc'),
      })
    }
  }, [actionData, t])

  // Profile image state:
  //  - `avatarUrl` is the CDN URL that will be saved on submit.
  //  - `localPreview` is a browser-only blob URL shown while the upload is in-flight.
  const [avatarUrl, setAvatarUrl] = useState<string>(user.profile ?? '')
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // When the upload fetcher finishes, adopt the CDN URL and drop the blob preview.
  useEffect(() => {
    if (avatarFetcher.state !== 'idle') return
    if (!avatarFetcher.data) return
    if (avatarFetcher.data.error) {
      setUploadError(avatarFetcher.data.error)
      setLocalPreview(null)
    } else if (avatarFetcher.data.url) {
      setAvatarUrl(avatarFetcher.data.url)
      setLocalPreview(null)
      setUploadError(null)
    }
  }, [avatarFetcher.state, avatarFetcher.data])

  // Cleanup any outstanding blob URL on unmount or when replaced.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    }
  }, [localPreview])

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    // Immediate local preview.
    const preview = URL.createObjectURL(file)
    setLocalPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return preview
    })
    // Auto-upload to Bunny via /api/avatar.
    const fd = new FormData()
    fd.append('file', file)
    avatarFetcher.submit(fd, {
      method: 'post',
      action: '/api/avatar',
      encType: 'multipart/form-data',
    })
    // Allow re-selecting the same file.
    e.target.value = ''
  }

  const displayedAvatar = localPreview || avatarUrl || null
  const displayedInitials =
    ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '')).toUpperCase() ||
    user.tel.slice(-2)

  const joinDate = new Date(user.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen font-sans" style={{ background: '#7c3aed' }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3" style={{ background: '#1e0040', borderBottom: '1px solid #a78bfa' }}>
        <button
          onClick={() => { playClick(); navigate('/') }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-opacity hover:opacity-80"
          style={{ background: '#4c1d95', color: '#e9d5ff', border: '1px solid #7c3aed' }}
        >
          <ArrowLeft size={16} />
          {t('common.back')}
        </button>
        <h1 className="text-xl font-bold" style={{ color: '#fde68a' }}>{t('profile.title')}</h1>
      </header>

      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-6">
        {/* Save error banner (success goes to a toast instead — see effect above). */}
        {actionData && 'error' in actionData && actionData.error && (
          <div
            className="rounded-xl px-4 py-3 text-sm font-semibold text-center"
            style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
          >
            {actionData.error}
          </div>
        )}

        {/* Single unified card: avatar + identity + editable form */}
        <Form method="post">
          {/* Hidden — populated by avatar upload fetcher */}
          <input type="hidden" name="profile" value={avatarUrl} />

          <section
            className="flex flex-col gap-5 rounded-2xl px-5 py-6 sm:px-6"
            style={{ background: 'linear-gradient(135deg, #4c1d95, #1e0040)', border: '1px solid #a78bfa' }}
          >
            {/* Avatar + identity */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <div
                  className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full text-3xl font-bold shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
                    color: '#fde68a',
                    border: '3px solid #f59e0b',
                  }}
                >
                  {displayedAvatar ? (
                    <img
                      src={displayedAvatar}
                      alt="Profile avatar"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>{displayedInitials}</span>
                  )}
                  {uploading && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.5)' }}
                    >
                      <Loader size={24} className="animate-spin text-white" />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: '#fff',
                    border: '2px solid #4ade80',
                  }}
                  aria-label="Change profile picture"
                >
                  <Camera size={16} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={onPickFile}
                  className="hidden"
                />
              </div>

              <div className="text-center">
                <div className="text-lg font-bold" style={{ color: '#fde68a' }}>
                  {[user.firstName, user.lastName].filter(Boolean).join(' ') || t('profile.unnamed')}
                </div>
                <div className="text-sm text-white">{user.tel}</div>
                <div className="mt-1 text-xs text-white">{t('profile.memberSince', { date: joinDate })}</div>
              </div>

              {uploadError && (
                <div
                  className="w-full rounded-lg px-3 py-2 text-xs font-semibold"
                  style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
                >
                  {uploadError}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="h-px w-full" style={{ background: 'rgba(167,139,250,0.3)' }} />

            {/* Personal information */}
            <div className="text-sm font-bold" style={{ color: '#e9d5ff' }}>{t('profile.personalInfo')}</div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('profile.firstName')} htmlFor="firstName">
                <div className="relative">
                  <UserRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#a78bfa' }} />
                  <input
                    id="firstName"
                    name="firstName"
                    defaultValue={user.firstName ?? ''}
                    maxLength={NAME_MAX}
                    placeholder={t('profile.firstName')}
                    required
                    className="w-full rounded-lg py-2.5 pl-9 pr-3 text-sm font-semibold outline-none"
                    style={{ background: '#2d1b4e', color: '#fde68a', border: '2px solid #7c3aed' }}
                  />
                </div>
              </Field>

              <Field label={t('profile.lastName')} htmlFor="lastName">
                <div className="relative">
                  <UserRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#a78bfa' }} />
                  <input
                    id="lastName"
                    name="lastName"
                    defaultValue={user.lastName ?? ''}
                    maxLength={NAME_MAX}
                    placeholder={t('profile.lastName')}
                    required
                    className="w-full rounded-lg py-2.5 pl-9 pr-3 text-sm font-semibold outline-none"
                    style={{ background: '#2d1b4e', color: '#fde68a', border: '2px solid #7c3aed' }}
                  />
                </div>
              </Field>
            </div>

            <Field label={t('profile.dob')} htmlFor="dob">
              <input
                id="dob"
                name="dob"
                type="date"
                defaultValue={user.dob}
                required
                max={new Date().toISOString().slice(0, 10)}
                // `color-scheme: dark` makes iOS Safari render the native
                // date-picker overlay (and the "mm/dd/yyyy" placeholder) in
                // dark mode so it's visible on the purple background.
                // min-height prevents iOS's native picker from collapsing.
                className="block w-full rounded-lg px-3 py-2.5 text-sm font-semibold outline-none"
                style={{
                  background: '#2d1b4e',
                  color: '#fde68a',
                  border: '2px solid #7c3aed',
                  colorScheme: 'dark',
                  minHeight: 44,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                }}
              />
            </Field>

            <Field label={t('profile.phoneReadonly')} htmlFor="tel">
              <div className="relative">
                <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#6d28d9' }} />
                <input
                  id="tel"
                  name="tel"
                  value={user.tel}
                  readOnly
                  className="w-full rounded-lg py-2.5 pl-9 pr-3 text-sm font-semibold outline-none opacity-70"
                  style={{ background: '#1a0630', color: '#a78bfa', border: '2px solid #4c1d95', cursor: 'not-allowed' }}
                />
              </div>
            </Field>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="submit"
                disabled={saving || uploading}
                className="flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold tracking-widest transition-opacity disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff',
                  border: '2px solid #4ade80',
                }}
              >
                {saving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                {saving ? t('common.saving') : t('common.saveChanges')}
              </button>
            </div>
          </section>
        </Form>

        {/* Bank QR — uploaded once, reused on every withdraw. Replaceable
            here or from the withdraw modal; both POST to /api/bank-qr. */}
        <section
          className="flex flex-col gap-4 rounded-2xl px-5 py-6 sm:px-6"
          style={{ background: 'linear-gradient(135deg, #4c1d95, #1e0040)', border: '1px solid #a78bfa' }}
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold" style={{ color: '#e9d5ff' }}>{t('profile.bankQr')}</div>
            <span className="text-[10px] font-bold tracking-widest" style={{ color: '#a78bfa' }}>
              {currentBankQr ? t('profile.current') : t('profile.notSet')}
            </span>
          </div>
          <p className="text-xs" style={{ color: '#c4b5fd' }}>
            {t('profile.bankQrDesc')}
          </p>

          <div
            className="flex flex-col items-center gap-3 rounded-xl px-4 py-5"
            style={{ background: '#1e0040', border: `1.5px ${displayedBankQr ? 'solid' : 'dashed'} #7c3aed` }}
          >
            {displayedBankQr ? (
              <button
                type="button"
                onClick={() => setBankLightbox(displayedBankQr)}
                className="relative block w-full max-w-[240px] overflow-hidden rounded-lg transition-opacity hover:opacity-90"
                style={{ border: '2px solid #a78bfa' }}
                aria-label={t('withdraw.aria.viewQr')}
              >
                <img src={displayedBankQr} alt="Bank QR" className="block h-auto w-full object-contain" />
                {bankUploading && (
                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <Loader size={24} className="animate-spin text-white" />
                  </div>
                )}
              </button>
            ) : (
              <div className="flex flex-col items-center gap-1 py-4 text-center">
                <Camera size={32} style={{ color: '#a78bfa' }} />
                <div className="text-sm font-semibold" style={{ color: '#c4b5fd' }}>{t('profile.noBankYet')}</div>
                <div className="text-[10px]" style={{ color: '#7c3aed' }}>{t('withdraw.fileTypes')}</div>
              </div>
            )}

            <input
              ref={bankFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onPickBankQr}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => bankFileInputRef.current?.click()}
              disabled={bankUploading}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold tracking-widest transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: '#4c1d95', color: '#fde68a', border: '1.5px solid #7c3aed' }}
            >
              <Upload size={14} />
              {currentBankQr ? t('profile.replaceQr') : t('profile.uploadQr')}
            </button>
          </div>

          {bankUploadError && (
            <div
              className="rounded-lg px-3 py-2 text-xs font-semibold"
              style={{ background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid #f87171' }}
            >
              {bankUploadError}
            </div>
          )}
        </section>

        {/* Language switch — single source of truth for picking app locale. */}
        <section
          className="flex flex-col gap-3 rounded-2xl px-5 py-6 sm:px-6"
          style={{ background: 'linear-gradient(135deg, #4c1d95, #1e0040)', border: '1px solid #a78bfa' }}
        >
          <div className="text-sm font-bold" style={{ color: '#e9d5ff' }}>{t('profile.language')}</div>
          <p className="text-xs" style={{ color: '#c4b5fd' }}>{t('profile.languageDesc')}</p>
          <LanguageSwitch variant="inline" />
        </section>
      </div>

      {bankLightbox && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={e => { e.stopPropagation(); setBankLightbox(null) }}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setBankLightbox(null) }}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ background: '#4c1d95', border: '1px solid #7c3aed', color: '#e9d5ff' }}
            aria-label="Close preview"
          >
            <X size={20} />
          </button>
          <img src={bankLightbox} alt="Bank QR preview" className="max-h-full max-w-full object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold" style={{ color: '#a78bfa' }}>{label}</span>
      {children}
    </label>
  )
}
