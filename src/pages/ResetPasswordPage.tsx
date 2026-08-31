import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Music, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { LoadingSpinner } from '@/components/shared';

const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');

/**
 * Landing page for the password-reset email link.
 *
 * Supabase's client already parses the recovery token out of the URL and
 * establishes a temporary session automatically (detectSessionInUrl, on by
 * default) - by the time this component mounts, `supabase.auth.getSession()`
 * either already has that session or the link was invalid/expired. Setting
 * the new password is then just `auth.updateUser({ password })` against that
 * session; no token handling needed here.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [checkingLink, setCheckingLink] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;

    // onAuthStateChange fires PASSWORD_RECOVERY once supabase-js has parsed
    // the link and established the session; getSession as a fallback covers
    // the case where that already happened before this listener attached.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        setLinkValid(true);
        setCheckingLink(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        setLinkValid(true);
      }
      setCheckingLink(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        toast.error(updateError.message);
        return;
      }
      setDone(true);
      toast.success('Password updated.');
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

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
          className="w-full max-w-md glass-strong rounded-3xl p-8"
        >
          {!linkValid ? (
            <div className="space-y-4 text-center">
              <h2 className="text-2xl font-bold">Link expired</h2>
              <p className="text-sm text-muted-foreground">
                This reset link is no longer valid - links expire after a while, and can only be used once.
                Request a new one from the sign-in page.
              </p>
              <Button className="w-full" onClick={() => navigate('/login')}>
                Back to sign in
              </Button>
            </div>
          ) : done ? (
            <div className="space-y-4 text-center">
              <h2 className="text-2xl font-bold">Password updated</h2>
              <p className="text-sm text-muted-foreground">You can now sign in with your new password.</p>
              <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
                Continue
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <h2 className="text-2xl font-bold text-center mb-2">Set a new password</h2>

              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    name="new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-muted/50 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  name="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-muted/50"
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update password'
                )}
              </Button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
