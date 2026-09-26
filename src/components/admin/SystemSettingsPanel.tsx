import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSystemSettings, useUpdateSetting } from '@/hooks/useSystemSettings';
import {
  LIMIT_MAX_COUNT,
  LIMIT_MAX_WINDOW_SECONDS,
  SETTING_META,
  TEXT_MAX_LENGTH,
  type FlagKey,
  type LimitKey,
  type RateLimitValue,
  type SettingKey,
  type SettingValues,
} from '@/lib/systemSettings';

/**
 * Feature flags, rate limits and site preferences. Switches save the moment
 * they are flipped; fields that take typing (limits, messages) save from an
 * explicit button so a half-typed value is never published.
 */

const FLAG_KEYS: FlagKey[] = [
  'flag.signups_enabled',
  'flag.forum_enabled',
  'flag.chat_enabled',
  'flag.billing_enabled',
  'flag.comments_enabled',
];
const LIMIT_KEYS: LimitKey[] = ['limit.comments', 'limit.interactions'];

function SettingRow({
  htmlFor,
  label,
  description,
  children,
}: {
  htmlFor: string;
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1 sm:max-w-md">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function LimitEditor({
  settingKey,
  value,
  saving,
  onSave,
}: {
  settingKey: LimitKey;
  value: RateLimitValue;
  saving: boolean;
  onSave: (next: RateLimitValue) => void;
}) {
  const [max, setMax] = useState(String(value.max));
  const [windowSeconds, setWindowSeconds] = useState(String(value.windowSeconds));

  const nextMax = Number(max);
  const nextWindow = Number(windowSeconds);
  const valid =
    max.trim() !== '' &&
    windowSeconds.trim() !== '' &&
    Number.isInteger(nextMax) &&
    nextMax >= 0 &&
    nextMax <= LIMIT_MAX_COUNT &&
    Number.isInteger(nextWindow) &&
    nextWindow >= 1 &&
    nextWindow <= LIMIT_MAX_WINDOW_SECONDS;
  const dirty = nextMax !== value.max || nextWindow !== value.windowSeconds;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Input
        id={settingKey}
        type="number"
        inputMode="numeric"
        min={0}
        max={LIMIT_MAX_COUNT}
        value={max}
        onChange={(e) => setMax(e.target.value)}
        aria-label={`${SETTING_META[settingKey].label}: maximum actions per window`}
        className="w-24"
      />
      <span className="text-muted-foreground">per</span>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={LIMIT_MAX_WINDOW_SECONDS}
        value={windowSeconds}
        onChange={(e) => setWindowSeconds(e.target.value)}
        aria-label={`${SETTING_META[settingKey].label}: window in seconds`}
        className="w-24"
      />
      <span className="text-muted-foreground">sec</span>
      <Button
        size="sm"
        disabled={!valid || !dirty || saving}
        onClick={() => onSave({ max: nextMax, windowSeconds: nextWindow })}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
      </Button>
    </div>
  );
}

function TextEditor({
  settingKey,
  value,
  saving,
  placeholder,
  onSave,
}: {
  settingKey: SettingKey;
  value: string;
  saving: boolean;
  placeholder?: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <div className="w-full space-y-2 sm:w-80">
      <Textarea
        id={settingKey}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={TEXT_MAX_LENGTH}
        placeholder={placeholder}
        className="min-h-[80px] resize-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {draft.length}/{TEXT_MAX_LENGTH}
        </span>
        <Button size="sm" disabled={draft === value || saving} onClick={() => onSave(draft.trim())}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export function SystemSettingsPanel() {
  const { settings } = useSystemSettings();
  const update = useUpdateSetting();
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  const isSaving = (key: SettingKey) => update.isPending && update.variables?.key === key;

  const save = <K extends SettingKey>(key: K, value: SettingValues[K]) => {
    update.mutate(
      { key, value },
      {
        onSuccess: () => toast.success(`${SETTING_META[key].label} saved`),
        onError: (error) => toast.error(`Couldn't save ${SETTING_META[key].label}: ${error.message}`),
      }
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Feature flags</CardTitle>
          <CardDescription>Turn parts of the app on or off. Changes reach users on their next page load or refocus.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {FLAG_KEYS.map((key) => (
            <SettingRow key={key} htmlFor={key} label={SETTING_META[key].label} description={SETTING_META[key].description}>
              <Switch
                id={key}
                checked={settings[key]}
                disabled={isSaving(key)}
                onCheckedChange={(checked) => save(key, checked)}
              />
            </SettingRow>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rate limits</CardTitle>
          <CardDescription>
            Enforced in each visitor's browser to stop accidental spam and runaway loops — not a substitute for
            server-side abuse protection. Set the count to 0 to remove a limit.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {LIMIT_KEYS.map((key) => (
            <SettingRow key={key} htmlFor={key} label={SETTING_META[key].label} description={SETTING_META[key].description}>
              {/* Remounts when the saved value changes so the draft resets to it. */}
              <LimitEditor
                key={`${settings[key].max}/${settings[key].windowSeconds}`}
                settingKey={key}
                value={settings[key]}
                saving={isSaving(key)}
                onSave={(next) => save(key, next)}
              />
            </SettingRow>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System preferences</CardTitle>
          <CardDescription>Site-wide notices and maintenance.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow
            htmlFor="pref.maintenance_mode"
            label={SETTING_META['pref.maintenance_mode'].label}
            description={SETTING_META['pref.maintenance_mode'].description}
          >
            <Switch
              id="pref.maintenance_mode"
              checked={settings['pref.maintenance_mode']}
              disabled={isSaving('pref.maintenance_mode')}
              onCheckedChange={(checked) => {
                // Turning it on locks every non-admin out, so ask first.
                // Turning it off is always safe and goes straight through.
                if (checked) setConfirmMaintenance(true);
                else save('pref.maintenance_mode', false);
              }}
            />
          </SettingRow>

          <SettingRow
            htmlFor="pref.maintenance_message"
            label={SETTING_META['pref.maintenance_message'].label}
            description={SETTING_META['pref.maintenance_message'].description}
          >
            <TextEditor
              key={settings['pref.maintenance_message']}
              settingKey="pref.maintenance_message"
              value={settings['pref.maintenance_message']}
              saving={isSaving('pref.maintenance_message')}
              onSave={(next) => save('pref.maintenance_message', next)}
            />
          </SettingRow>

          <SettingRow
            htmlFor="pref.announcement"
            label={SETTING_META['pref.announcement'].label}
            description={SETTING_META['pref.announcement'].description}
          >
            <TextEditor
              key={settings['pref.announcement']}
              settingKey="pref.announcement"
              value={settings['pref.announcement']}
              saving={isSaving('pref.announcement')}
              placeholder="e.g. New harmony detection goes live Friday"
              onSave={(next) => save('pref.announcement', next)}
            />
          </SettingRow>
        </CardContent>
      </Card>

      <AlertDialog open={confirmMaintenance} onOpenChange={setConfirmMaintenance}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on maintenance mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone except admins will see the maintenance screen instead of the site until you turn it off. You
              stay signed in and can keep using the site, including this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => save('pref.maintenance_mode', true)}>Turn on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
