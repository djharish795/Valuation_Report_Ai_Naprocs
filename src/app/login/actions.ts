'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    redirect('/login?error=missing_fields')
  }

  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password: password.trim(),
  })

  if (error) {
    console.error('Login error:', error.message)
    const msg = error.message.toLowerCase()
    if (msg.includes('email not confirmed') || error.code === 'email_not_confirmed') {
      redirect('/login?error=email_not_confirmed')
    }
    if (msg.includes('invalid login credentials') || error.code === 'invalid_credentials') {
      redirect('/login?error=invalid_credentials')
    }
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/')
}

export async function logout() {
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
