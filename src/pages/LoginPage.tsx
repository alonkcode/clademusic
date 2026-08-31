import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Music, Loader2, ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import { LoadingSpinner } from '@/components/shared';

// Google's brand mark isn't in lucide-react (a generic icon set, not brand
// logos), so it's inlined here as the standard four-color "G".
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

const authSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  displayName: z.string().min(2, 'Name must be at least 2 characters').optional(),
});

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn, signUp, signInWithGoogle, sendPasswordReset, user, loading, enterGuestMode, guestMode } =
    useAuth();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // If auth already resolved and user exists, hand off to the gate
  useEffect(() => {
    if (!loading && user) {
      navigate('/auth', { replace: true });
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = authSchema.safeParse({
      email,
      password,
      displayName: mode === 'signup' ? displayName : undefined,
    });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast.error('Invalid email or password');
          } else {
            toast.error(error.message);
          }
          return;
        }
        toast.success('Welcome back!');
        navigate('/auth', { replace: true });
      } else {
        const { error, needsEmailConfirmation, alreadyRegistered } = await signUp(
          email,
          password,
          displayName
        );
        if (error) {
          toast.error(
            /already registered|already exists/i.test(error.message)
              ? 'This email is already registered'
              : error.message
          );
          return;
        }
        if (alreadyRegistered) {
          // Supabase reports an existing email as success (no error) to avoid
          // letting anyone enumerate registered addresses from the response
          // alone, so this has to be detected separately rather than read off
          // `error`.
          toast.error('This email is already registered. Try signing in instead.');
          setMode('signin');
          return;
        }
        if (needsEmailConfirmation) {
          // The account exists but has no session yet - it cannot sign in
          // until the emailed link is clicked. Saying "please sign in" here
          // sends the user straight into an "Invalid email or password"-style
          // dead end for a password that is actually correct.
          toast.success(`Check ${email} for a confirmation link to finish signing up.`);
          setMode('signin');
          return;
        }
        // Email confirmation disabled: signUp already returned a live session.
        toast.success('Welcome to CladeMusic!');
        navigate('/auth', { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrors({ email: 'Enter your email to receive a reset link' });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await sendPasswordReset(email);
      if (error) {
        toast.error(error.message);
        return;
      }
      // Supabase does not distinguish "no such account" in this response
      // either, for the same enumeration reason as signup - the message is
      // deliberately unconditional.
      setResetSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleSubmitting(true);
    try {
      const { error } = await signInWithGoogle();
      // On success the page navigates away to Google immediately; an error
      // here means that redirect never happened.
      if (error) {
        toast.error(
          /provider is not enabled/i.test(error.message)
            ? 'Google sign-in is not enabled for this project yet.'
            : error.message
        );
        setGoogleSubmitting(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start Google sign-in');
      setGoogleSubmitting(false);
    }
  };

  if (loading && !user) {
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
        {!guestMode && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-xl border border-border/50 bg-background/60 px-4 py-3 text-sm text-muted-foreground backdrop-blur"
          >
            Explore first, sign up when you’re ready. You can browse the feed and play previews without an account.
          </motion.div>
        )}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute top-6 left-6"
        >
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}> 
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </motion.div>

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
          <h2 className="text-2xl font-bold text-center mb-2">
            {mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create an account' : 'Reset your password'}
          </h2>
          <p className="text-muted-foreground text-center mb-6">
            {mode === 'signin'
              ? 'Sign in to discover your harmonic matches'
              : mode === 'signup'
                ? 'Start discovering music through harmony'
                : "We'll email you a link to set a new one"}
          </p>

          {mode === 'forgot' ? (
            resetSent ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset
                  link is on its way. Check your inbox (and spam folder).
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setMode('signin');
                    setResetSent(false);
                  }}
                >
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-muted/50"
                  />
                  {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                </div>

                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending link...
                    </>
                  ) : (
                    'Send reset link'
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  Back to sign in
                </button>
              </form>
            )
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  enterGuestMode();
                  toast.info('Guest mode enabled — explore the feed freely.');
                  navigate('/feed');
                }}
              >
                Continue as guest
              </Button>

              <div className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                <div className="h-px flex-1 bg-border" />
                <span>or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {mode === 'signup' && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display name</Label>
                  <Input
                    id="displayName"
                    name="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="bg-muted/50"
                  />
                  {errors.displayName && (
                    <p className="text-xs text-destructive">{errors.displayName}</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-muted/50"
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => setMode('forgot')}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
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
                {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              </div>

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {mode === 'signin' ? 'Signing in...' : 'Creating account...'}
                  </>
                ) : (
                  <>{mode === 'signin' ? 'Sign in' : 'Create account'}</>
                )}
              </Button>

              <div className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                <div className="h-px flex-1 bg-border" />
                <span>or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full justify-center gap-2"
                disabled={googleSubmitting}
                onClick={handleGoogleSignIn}
              >
                {googleSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <GoogleIcon className="w-4 h-4" />
                )}
                Continue with Google
              </Button>
            </form>
          )}

          {mode !== 'forgot' && (
            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                {mode === 'signin' ? (
                  <>
                    Don't have an account?{' '}
                    <button
                      onClick={() => navigate('/signup')}
                      className="text-primary hover:underline font-medium"
                    >
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      onClick={() => setMode('signin')}
                      className="text-primary hover:underline font-medium"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-xs text-muted-foreground text-center mt-6 max-w-sm"
        >
          By signing up, you agree that harmonic analysis is probabilistic and may not always be accurate.
        </motion.p>
      </div>
    </div>
  );
}
