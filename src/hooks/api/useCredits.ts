import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/** Reads the same public.credits table BillingPage displays, so a spend here
 *  is reflected there without any separate wiring. */
export function useCredits() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['credits', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credits')
        .select('balance')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      // No row is a real, expected state (e.g. a user who signed up before
      // the credits table existed and hasn't been backfilled) - treat as 0
      // rather than throwing, so the UI can still show a sensible balance.
      return data?.balance ?? 0;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });
}

export interface SpendCreditResult {
  success: boolean;
  remainingBalance: number;
}

/**
 * Spends credits via the spend_credit() RPC - an atomic check-and-decrement
 * in Postgres, not a read-balance-then-write-balance round trip from the
 * client, which would race under concurrent use.
 */
export function useSpendCredit() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount, reason }: { amount: number; reason: string }): Promise<SpendCreditResult> => {
      if (!user) throw new Error('Must be signed in to spend credits');

      const { data, error } = await supabase.rpc('spend_credit', {
        p_user_id: user.id,
        p_amount: amount,
        p_reason: reason,
      });
      if (error) throw error;

      // supabase-js returns RETURNS TABLE results as an array of rows.
      const row = Array.isArray(data) ? data[0] : data;
      return { success: !!row?.success, remainingBalance: row?.remaining_balance ?? 0 };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credits', user?.id] });
    },
  });
}
