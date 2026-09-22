import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2, Music, MailCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { stashAuthRedirectError } from '@/lib/authHashError';
import type { EmailOtpType } from '@supabase/supabase-js';

const VALID_TYPES: readonly EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

// Reached from the confirmation email's link. Verification only happens on
// the explicit button click below, never on page load - the email itself
// links straight to the Supabase verify endpoint (which burns the one-time
// token on any GET), and mail providers routinely prefetch/scan links before
// a user ever clicks them. Routing the link here first and requiring a real
// click keeps that prefetch from silently invalidating the token.
export default function ConfirmEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [confirming, setConfirming] = useState(false);

  const tokenHash = searchParams.get('token_hash');
  const type = useMemo<EmailOtpType>(() => {
    const raw = searchParams.get('type');
    return raw && (VALID_TYPES as string[]).includes(raw) ? (raw as EmailOtpType) : 'signup';
  }, [searchParams]);

  const handleConfirm = async () => {
    if (!tokenHash) return;
    setConfirming(true);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      // Reuse the same "link expired" UI that /login already shows for the
      // legacy ConfirmationURL flow, so both paths land on one message.
      stashAuthRedirectError(error.message || 'Your confirmation link has expired.');
      navigate('/login', { replace: true });
      return;
    }
    navigate('/auth', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/10" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-8"
        >
          <div className="p-3 rounded-2xl bg-primary/20 glow-primary">
            <Music className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">CladeMusic</h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="w-full max-w-md glass-strong rounded-3xl p-8 text-center"
        >
          {!tokenHash ? (
            <>
              <h2 className="text-2xl font-bold mb-2">Invalid confirmation link</h2>
              <p className="text-muted-foreground mb-6">
                This link is missing its confirmation code. Request a new one from the sign-in page.
              </p>
              <Button className="w-full" onClick={() => navigate('/login')}>
                Go to sign in
              </Button>
            </>
          ) : (
            <>
              <MailCheck className="w-10 h-10 text-primary mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-2">Confirm your email</h2>
              <p className="text-muted-foreground mb-6">
                Click below to finish verifying your account.
              </p>
              <Button className="w-full" onClick={handleConfirm} disabled={confirming}>
                {confirming ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  'Confirm email'
                )}
              </Button>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
