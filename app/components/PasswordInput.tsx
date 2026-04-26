import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordInputProps {
  name: string
  autoComplete?: 'current-password' | 'new-password'
  required?: boolean
  minLength?: number
  placeholder?: string
}

// Password input with a toggle button on the right that flips the input type
// between `password` and `text`. Each instance carries its own visibility state,
// so login's one field and register's two fields toggle independently.
export function PasswordInput({
  name,
  autoComplete = 'current-password',
  required,
  minLength,
  placeholder,
}: PasswordInputProps) {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <input
        name={name}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2.5 pr-11 text-sm font-semibold outline-none"
        style={{ background: '#2d1b4e', color: '#fde68a', border: '2px solid #7c3aed' }}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md transition-opacity hover:opacity-80"
        style={{ color: '#c4b5fd' }}
        aria-label={show ? 'Hide password' : 'Show password'}
        // tabIndex=-1 keeps tab order: phone → password → submit (skipping the eye toggle)
        tabIndex={-1}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}
