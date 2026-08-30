// Supabase Edge Function: send transactional email via Resend.
//
// WHY THIS IS A FUNCTION AND NOT APP CODE
// A Resend API key can send mail as your verified domain, so it is a true
// secret. This app is a Vite SPA: everything under src/ is bundled and shipped
// to the browser, so calling the Resend SDK from the frontend would publish the
// key to every visitor. It lives here instead, where Deno.env keeps it on the
// server and the caller must present a valid Supabase JWT.
//
// NOTE: this is NOT how auth confirmation / password reset emails are sent.
// Supabase sends those itself - point it at Resend under
// Authentication -> Emails -> SMTP Settings. This function is only for email
// the application itself originates.
//
// Deploy:
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxx --project-ref <ref>
//   supabase functions deploy send-email --project-ref <ref>
//
// Call from the app (the user's session token authorises it):
//   const { data, error } = await supabase.functions.invoke('send-email', {
//     body: { to: 'someone@example.com', subject: 'Hello', html: '<p>Hi</p>' },
//   });

import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

// Must be a verified domain in Resend, or onboarding@resend.dev while testing.
const FROM_ADDRESS = Deno.env.get('RESEND_FROM') ?? 'CladeMusic <onboarding@resend.dev>';

interface SendEmailBody {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Deliberately strict: an open relay behind your domain would be spam-abused.
const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!RESEND_API_KEY) {
    // Fail loudly rather than silently not sending.
    return json({ error: 'RESEND_API_KEY is not configured on this function' }, 500);
  }

  // Require a signed-in user. Without this the function is an open relay that
  // anyone who finds the URL can send mail through as your domain.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);

  let body: SendEmailBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const recipients = Array.isArray(body.to) ? body.to : [body.to];
  if (recipients.length === 0 || recipients.length > 50) {
    return json({ error: 'Provide between 1 and 50 recipients' }, 400);
  }
  if (!recipients.every(isEmail)) {
    return json({ error: 'One or more recipient addresses are invalid' }, 400);
  }
  if (typeof body.subject !== 'string' || body.subject.trim() === '') {
    return json({ error: 'subject is required' }, 400);
  }
  if (!body.html && !body.text) {
    return json({ error: 'Provide html or text' }, 400);
  }

  // Resend's REST API directly - no SDK needed, and nothing extra to pin.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: recipients,
      subject: body.subject,
      html: body.html,
      text: body.text,
      reply_to: body.replyTo,
    }),
  });

  const result = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Surface Resend's message; the most common ones are an unverified sending
    // domain and a malformed `from` address.
    console.error('resend send failed', res.status, result);
    return json({ error: result?.message ?? 'Failed to send email' }, res.status);
  }

  return json({ id: result?.id, sent: recipients.length });
});
