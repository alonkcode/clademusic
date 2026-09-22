/**
 * The plan catalogue - name, price, and monthly credit allowance per tier.
 *
 * Single source of truth so a plan's credit number can't drift between
 * screens that show it for different reasons: BillingPage (what you get if
 * you upgrade) and ProfilePage (how much of this cycle's allowance is left).
 * Both import PLAN_COPY/PlanKey from here rather than declaring their own copy.
 */
export const PLAN_COPY = {
  free: {
    name: 'Free',
    price: '₪0',
    interval: 'month',
    credits: 2500,
    features: ['Monthly credits', 'No card required', 'Basic access'],
  },
  starter: {
    name: 'Starter',
    price: '₪149',
    interval: 'month',
    credits: 500,
    features: ['Monthly subscription', 'Medium credit allowance', 'Email support'],
  },
  pro: {
    name: 'Pro',
    price: '₪349',
    interval: 'month',
    credits: 2000,
    features: ['Higher credit allowance', 'Priority features', 'Priority support'],
  },
} as const;

export type PlanKey = keyof typeof PLAN_COPY;

export function isPlanKey(value: string | undefined | null): value is PlanKey {
  return !!value && value in PLAN_COPY;
}
