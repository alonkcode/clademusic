<#
Bundle supabase/migrations into one SQL file that applies cleanly to an EMPTY
Supabase project via the SQL Editor.

This is the PowerShell equivalent of build-schema-bundle.sh for Windows. The
Bash script remains the CI-canonical generator; both scripts intentionally use
the same dependency order, rewrites, and compatibility files.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$outputPath = Join-Path (Get-Location) 'supabase/schema_bundle.sql'

$order = @(
	'20260114211348_2a4485e7-9d33-4c9d-9ea8-0420e1ad4044.sql'
	'20260114211408_1be47900-6c38-4adb-b34e-5dfe41a998e4.sql'
	'20260115085704_58686868-f4a3-4d8f-9b0b-766b1d0430fc.sql'
	'20260115092130_unified_music_schema.sql'
	'20260117165737_58521ad8-f29a-48ec-b38b-292f2369be61.sql'
	'20260118065431_c2bd75bd-b63c-4560-bc4c-0f96e698af9d.sql'
	'20260120091200_add_sections_to_tracks.sql'
	'20260120201900_fix_user_locations_rls.sql'
	'20260120202800_critical_security_fixes.sql'
	'20260120_add_track_sections.sql'
	'20260120_secure_2fa_secrets.sql'
	'20260122_reddit_forum.sql'
	'20260122_emoji_reactions.sql'
	'20260122_live_chat.sql'
	'20260122_track_comments.sql'
	'20260122_playlists.sql'
	'20260122_unified_interactions.sql'
	'20260122_profile_themes.sql'
	'20260122_premium_billing.sql'
	'20260122_performance_tracking.sql'
	'20260122_optimize_indexes.sql'
	'20260122_performance_optimization.sql'
	'202601240001_test_runs.sql'
	'20260124_billing_core.sql'
	'20260125_harmonic_analysis_core.sql'
	'20260204130000_playback_telemetry.sql'
	'20260828120000_harden_signup_trigger.sql'
	'20260828140000_harden_auto_playlists.sql'
	'20260901120000_wire_credits_to_live_detection.sql'
	'20260921190700_grant_signup_credits.sql'
	'20260923120000_system_settings.sql'
	'20260923130000_fix_interaction_writes.sql'
)

function Get-FixedSql([string] $path) {
	$sql = [IO.File]::ReadAllText((Join-Path (Get-Location) $path)
	)

	$sql = $sql -creplace 'CREATE INDEX CONCURRENTLY', 'CREATE INDEX'
	$sql = $sql -creplace '(?m)^[ \t]*ALTER SYSTEM SET', '-- [bundle] removed, not permitted on Supabase: ALTER SYSTEM SET'
	$sql = $sql -creplace '(?m)^WHEN \(NEW\.(post_id|comment_id) IS NOT NULL OR OLD\.(post_id|comment_id) IS NOT NULL\)\r?\n', ''
	$sql = $sql -creplace '(?m)^CREATE TRIGGER ', 'CREATE OR REPLACE TRIGGER '
	$sql = $sql -creplace '(?m)^create trigger ', 'create or replace trigger '
	$sql = $sql -creplace '(?m)^CREATE INDEX ([a-zA-Z_][a-zA-Z0-9_]*) ON ', 'CREATE INDEX IF NOT EXISTS $1 ON '
	$sql = $sql -creplace '(?m)^CREATE UNIQUE INDEX ([a-zA-Z_][a-zA-Z0-9_]*) ON ', 'CREATE UNIQUE INDEX IF NOT EXISTS $1 ON '
	$sql = $sql -creplace '(?m)^create index ([a-zA-Z_][a-zA-Z0-9_]*) on ', 'create index if not exists $1 on '
	$sql = $sql -creplace 'LIKE chat_messages INCLUDING ALL', 'LIKE chat_messages INCLUDING DEFAULTS'
	$sql = $sql -creplace 'LIKE forum_posts INCLUDING ALL', 'LIKE forum_posts INCLUDING DEFAULTS'
	$sql = $sql -creplace 'LEFT JOIN public\.user_interactions ui ON ui\.track_id = t\.id', 'LEFT JOIN public.user_interactions ui ON ui.track_id = t.id::text'
	$sql = $sql -creplace '(?m)^WHERE created_at > NOW\(\)[^;]* AND NOT is_deleted;', 'WHERE NOT is_deleted;'
	$sql = $sql -creplace '(?m)^WHERE [a-z_]* > NOW\(\)[^;]*;', ';'
	$sql = $sql -creplace '(?m) WHERE [a-z_]* > NOW\(\)[^;]*;', ';'
	$sql = $sql -creplace "(?m)^  reuse_until timestamptz generated always as \(analysis_timestamp \+ interval '90 days'\) stored,", "  reuse_until timestamptz not null default (now() + interval '90 days'),"
	$sql = $sql -creplace "(?m)^  reanalyze_after timestamptz generated always as \(analysis_timestamp \+ interval '365 days'\) stored,", "  reanalyze_after timestamptz not null default (now() + interval '365 days'),"

	return $sql
}

function Add-Section([System.Collections.Generic.List[string]] $lines, [string] $name, [string] $content) {
	[void] $lines.Add('')
	[void] $lines.Add('-- ============================================================')
	[void] $lines.Add("-- $name")
	[void] $lines.Add('-- ============================================================')
	[void] $lines.Add($content.TrimEnd())
	[void] $lines.Add('')
}

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('-- GENERATED FILE - do not edit by hand.')
$lines.Add('-- Source: supabase/migrations/*.sql (dependency order, not filename order)')
$lines.Add('-- Regenerate: bash scripts/build-schema-bundle.sh')
$lines.Add('-- Verify:     bash scripts/test-schema-bundle.sh')
$lines.Add('--')
$lines.Add('-- Apply to a FRESH project via the Supabase SQL Editor.')
$lines.Add('-- Wrapped in a transaction: it either fully applies or fully rolls back.')
$lines.Add('')
$lines.Add('BEGIN;')
$lines.Add('')

foreach ($file in $order) {
	Add-Section $lines $file (Get-FixedSql "supabase/migrations/$file")

	if ($file -eq '20260120_secure_2fa_secrets.sql') {
		Add-Section $lines 'bundle-fixes/00-compat-prelude.sql' (Get-Content 'supabase/bundle-fixes/00-compat-prelude.sql' -Raw)
	}
	if ($file -eq '20260122_reddit_forum.sql') {
		Add-Section $lines 'bundle-fixes/03-forum-compat.sql' (Get-Content 'supabase/bundle-fixes/03-forum-compat.sql' -Raw)
	}
	if ($file -eq '20260122_playlists.sql') {
		Add-Section $lines 'bundle-fixes/05-playlists-compat.sql' (Get-Content 'supabase/bundle-fixes/05-playlists-compat.sql' -Raw)
	}
	if ($file -eq '20260125_harmonic_analysis_core.sql') {
		Add-Section $lines 'bundle-fixes/10-harmonic-retention.sql' (Get-Content 'supabase/bundle-fixes/10-harmonic-retention.sql' -Raw)
	}
	if ($file -eq '20260923130000_fix_interaction_writes.sql') {
		Add-Section $lines 'sql-editor/17-live-detection-runs.sql' (Get-Content 'supabase/sql-editor/17-live-detection-runs.sql' -Raw)
		Add-Section $lines 'sql-editor/18-promote-detection-run.sql' (Get-Content 'supabase/sql-editor/18-promote-detection-run.sql' -Raw)
		Add-Section $lines 'sql-editor/19-save-track-sections.sql' (Get-Content 'supabase/sql-editor/19-save-track-sections.sql' -Raw)
		Add-Section $lines 'sql-editor/29-auto-analysis.sql' (Get-Content 'supabase/sql-editor/29-auto-analysis.sql' -Raw)
		Add-Section $lines 'sql-editor/30-undo-promotion.sql' (Get-Content 'supabase/sql-editor/30-undo-promotion.sql' -Raw)
		Add-Section $lines 'sql-editor/31-save-track-sections-mirror.sql' (Get-Content 'supabase/sql-editor/31-save-track-sections-mirror.sql' -Raw)
	}
}

$lines.Add('COMMIT;')
[IO.File]::WriteAllText($outputPath, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
Write-Output "Wrote $outputPath ($($lines.Count) lines)"