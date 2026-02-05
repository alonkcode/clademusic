/**
 * Diagnostic utility to check Spotify integration health
 * Run this from browser console: window.spotifyDiagnostics()
 */

import { isSupabaseConfigured } from '@/integrations/supabase/client';

export interface DiagnosticResult {
  category: string;
  check: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, any>;
}

export async function runSpotifyDiagnostics(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  // Check environment variables
  results.push({
    category: 'Environment',
    check: 'Supabase URL',
    status: import.meta.env.VITE_SUPABASE_URL ? 'pass' : 'fail',
    message: import.meta.env.VITE_SUPABASE_URL
      ? `Configured: ${import.meta.env.VITE_SUPABASE_URL.substring(0, 30)}...`
      : 'Missing VITE_SUPABASE_URL in environment',
  });

  results.push({
    category: 'Environment',
    check: 'Supabase Key',
    status: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? 'pass' : 'fail',
    message: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
      ? `Configured (${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.length} chars)`
      : 'Missing VITE_SUPABASE_PUBLISHABLE_KEY in environment',
  });

  results.push({
    category: 'Environment',
    check: 'Spotify Client ID',
    status: import.meta.env.VITE_SPOTIFY_CLIENT_ID ? 'pass' : 'warn',
    message: import.meta.env.VITE_SPOTIFY_CLIENT_ID
      ? `Configured: ${import.meta.env.VITE_SPOTIFY_CLIENT_ID.substring(0, 10)}...`
      : 'Missing VITE_SPOTIFY_CLIENT_ID - Spotify features disabled',
  });

  results.push({
    category: 'Environment',
    check: 'Spotify Redirect URI',
    status: import.meta.env.VITE_SPOTIFY_REDIRECT_URI ? 'pass' : 'warn',
    message: import.meta.env.VITE_SPOTIFY_REDIRECT_URI
      ? `Configured: ${import.meta.env.VITE_SPOTIFY_REDIRECT_URI}`
      : `Using default: ${window.location.origin}/spotify-callback`,
  });

  // Check Supabase configuration
  results.push({
    category: 'Database',
    check: 'Supabase Client',
    status: isSupabaseConfigured() ? 'pass' : 'fail',
    message: isSupabaseConfigured()
      ? 'Supabase client properly configured'
      : 'Supabase client not configured - check environment variables',
  });

  // Check localStorage
  const oauthState = localStorage.getItem('harmony_hub_oauth_state');
  results.push({
    category: 'OAuth',
    check: 'OAuth State',
    status: oauthState ? 'warn' : 'pass',
    message: oauthState
      ? 'OAuth state present (possible interrupted flow)'
      : 'No pending OAuth state',
    details: oauthState ? { state: oauthState.substring(0, 10) + '...' } : undefined,
  });

  // Check session storage for consumed codes
  const consumedCodes = Object.keys(sessionStorage).filter(k => k.startsWith('spotify_code_'));
  results.push({
    category: 'OAuth',
    check: 'Consumed Codes',
    status: consumedCodes.length > 0 ? 'warn' : 'pass',
    message: consumedCodes.length > 0
      ? `${consumedCodes.length} consumed authorization codes in session`
      : 'No consumed codes in session',
    details: consumedCodes.length > 0 ? { count: consumedCodes.length } : undefined,
  });

  // Check if user is logged in
  const supabaseUser = localStorage.getItem('sb-fteefcvikpowcewuqqez-auth-token');
  results.push({
    category: 'Authentication',
    check: 'User Session',
    status: supabaseUser ? 'pass' : 'warn',
    message: supabaseUser ? 'User is logged in' : 'No active user session',
  });

  return results;
}

export function printDiagnostics(results: DiagnosticResult[]): void {
  console.log('\n🔍 Spotify Integration Diagnostics\n');
  console.log('═'.repeat(60));

  const grouped = results.reduce((acc, result) => {
    if (!acc[result.category]) acc[result.category] = [];
    acc[result.category].push(result);
    return acc;
  }, {} as Record<string, DiagnosticResult[]>);

  for (const [category, checks] of Object.entries(grouped)) {
    console.log(`\n📂 ${category}`);
    console.log('─'.repeat(60));

    for (const check of checks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
      console.log(`${icon} ${check.check}: ${check.message}`);
      if (check.details) {
        console.log(`   Details:`, check.details);
      }
    }
  }

  console.log('\n═'.repeat(60));

  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;
  const passed = results.filter(r => r.status === 'pass').length;

  console.log(`\nSummary: ${passed} passed, ${warned} warnings, ${failed} failed\n`);

  if (failed > 0) {
    console.log('❌ Critical issues found. Check the failed items above.');
    console.log('   See docs/SPOTIFY_SETUP.md for setup instructions.');
  } else if (warned > 0) {
    console.log('⚠️  Some warnings present. Everything should work, but check warnings above.');
  } else {
    console.log('✅ All checks passed! Spotify integration is properly configured.');
  }
}

// Expose to window for easy access from console
if (typeof window !== 'undefined') {
  (window as any).spotifyDiagnostics = async () => {
    const results = await runSpotifyDiagnostics();
    printDiagnostics(results);
    return results;
  };
  console.log('💡 Run window.spotifyDiagnostics() to check Spotify integration health');
}
