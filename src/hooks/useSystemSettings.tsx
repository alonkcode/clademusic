import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { checkRateLimit } from '@/lib/security';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type LimitKey,
  type SettingKey,
  type SettingRow,
  type SettingValues,
} from '@/lib/systemSettings';

const QUERY_KEY = ['systemSettings'] as const;

interface SystemSettingsContextValue {
  settings: SettingValues;
  /** True only until the first fetch settles; settings are the defaults meanwhile. */
  isLoading: boolean;
}

// The default is the real defaults, not undefined: components that read
// settings (nav links, comment forms) render fine in isolation - in tests, in
// Storybook - without a provider, and behave as they did before settings existed.
const SystemSettingsContext = createContext<SystemSettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  isLoading: false,
});

// system_settings is not in the generated Database types yet (the migration
// adds it). This is just enough of the client's surface to talk to it.
type Result<T> = PromiseLike<{ data: T; error: { message: string } | null }>;
interface UntypedSupabase {
  from(table: string): {
    select(columns: string): Result<unknown>;
    upsert(row: object, options: { onConflict: string }): Result<null>;
  };
}
const settingsTable = () => (supabase as unknown as UntypedSupabase).from('system_settings');

async function fetchSettings(): Promise<SettingValues> {
  const { data, error } = await settingsTable().select('key, value');
  // Throw rather than return the defaults: a failed background refetch then
  // leaves the last good values in the cache instead of overwriting a
  // disabled flag with its default. On a cold start the provider still falls
  // back to the defaults below, so a missing table never breaks the app.
  if (error) throw new Error(error.message);
  return mergeSettings((data ?? []) as SettingRow[]);
}

export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchSettings,
    staleTime: 60_000,
    // A missing table or a blip is not worth backing off for: retrying would
    // hold FeatureRoute / MaintenanceGate on a spinner for several seconds.
    retry: false,
  });

  const value = useMemo(
    () => ({ settings: data ?? DEFAULT_SETTINGS, isLoading }),
    [data, isLoading]
  );

  return <SystemSettingsContext.Provider value={value}>{children}</SystemSettingsContext.Provider>;
}

export function useSystemSettings(): SystemSettingsContextValue {
  return useContext(SystemSettingsContext);
}

export function useSetting<K extends SettingKey>(key: K): SettingValues[K] {
  return useSystemSettings().settings[key];
}

/**
 * Returns a guard to call once, right before performing a rate-limited action:
 * true means go ahead, false means the admin-configured limit was hit (and the
 * user has been told). Each call that returns true counts against the limit.
 *
 * This is the same in-browser limiter as checkRateLimit - it stops accidental
 * spamming and a runaway UI loop, not a determined client. A limit of 0 is off.
 */
export function useRateLimitGuard(key: LimitKey): () => boolean {
  const { max, windowSeconds } = useSetting(key);

  return useCallback(() => {
    if (max <= 0) return true;

    const result = checkRateLimit(key, max, windowSeconds * 1000);
    if (result.allowed) return true;

    toast({
      title: 'Slow down',
      description: `You're doing that too quickly. Try again in ${result.resetIn ?? windowSeconds}s.`,
      variant: 'destructive',
    });
    return false;
  }, [key, max, windowSeconds]);
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: SettingKey; value: SettingValues[SettingKey] }) => {
      const { error } = await settingsTable().upsert({ key, value }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    // Optimistic, so a switch flips at once instead of after the round trip.
    // Skipped when nothing has loaded yet (settings table unreachable): there
    // is nothing to roll back to, and a failed write must not leave a value
    // in the cache that was never saved.
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<SettingValues>(QUERY_KEY);
      if (previous) queryClient.setQueryData<SettingValues>(QUERY_KEY, { ...previous, [key]: value });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
