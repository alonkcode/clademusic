#!/usr/bin/env node
/**
 * Seed Database Script
 * Populates the database with sample tracks, provider links, and connections
 * 
 * Usage: node scripts/seed.js [--reset]
 */

import { createClient } from '@supabase/supabase-js';
import { seedTracksWithProviders } from '../src/data/seedTracksWithProviders.ts';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fteefcvikpowcewuqqez.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Clear existing seed data if --reset flag is provided
 */
async function clearData() {
  console.log('🧹 Clearing existing data...');
  
  // Delete in correct order due to foreign keys
  await supabase.from('track_connections').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('feed_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('track_provider_links').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('play_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('tracks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  console.log('✅ Data cleared');
}

/**
 * Insert track with provider links
 */
async function insertTrack(seedTrack, index) {
  const artists = seedTrack.artist ? [seedTrack.artist] : [];
  
  // Insert main track
  const { data: track, error: trackError } = await supabase
    .from('tracks')
    .insert({
      title: seedTrack.title,
      artist: seedTrack.artist,
      artists: artists,
      album: seedTrack.album,
      duration_ms: seedTrack.duration_ms,
      isrc: seedTrack.isrc,
      artwork_url: seedTrack.cover_url,
      detected_key: seedTrack.detected_key,
      detected_mode: seedTrack.detected_mode,
      progression_roman: seedTrack.progression_roman,
      loop_length_bars: seedTrack.loop_length_bars,
      energy: seedTrack.energy,
      danceability: seedTrack.danceability,
      valence: seedTrack.valence,
      sections: seedTrack.sections ? seedTrack.sections : null,
      external_id: seedTrack.spotify_id || seedTrack.youtube_id || `seed-${index}`,
      provider: seedTrack.spotify_id ? 'spotify' : 'youtube',
      popularity_score: Math.floor(Math.random() * 1000),
    })
    .select()
    .single();

  if (trackError) {
    console.error(`❌ Failed to insert track: ${seedTrack.title}`, trackError.message);
    return null;
  }

  // Insert provider links
  const providerLinks = [];
  
  if (seedTrack.spotify_id) {
    providerLinks.push({
      track_id: track.id,
      provider: 'spotify',
      provider_track_id: seedTrack.spotify_id,
      url_web: `https://open.spotify.com/track/${seedTrack.spotify_id}`,
      url_app: `spotify:track:${seedTrack.spotify_id}`,
    });
  }
  
  if (seedTrack.youtube_id) {
    providerLinks.push({
      track_id: track.id,
      provider: 'youtube',
      provider_track_id: seedTrack.youtube_id,
      url_web: `https://www.youtube.com/watch?v=${seedTrack.youtube_id}`,
      url_app: `vnd.youtube://watch?v=${seedTrack.youtube_id}`,
    });
  }

  if (providerLinks.length > 0) {
    const { error: linksError } = await supabase
      .from('track_provider_links')
      .insert(providerLinks);

    if (linksError) {
      console.error(`⚠️  Failed to insert provider links for: ${seedTrack.title}`, linksError.message);
    }
  }

  // Add to feed
  await supabase
    .from('feed_items')
    .insert({
      track_id: track.id,
      source: 'seed',
      rank: index,
    });

  return track;
}

/**
 * Create connection clusters for sample/cover/remix relationships
 */
async function createConnections(tracks) {
  console.log('🔗 Creating connection clusters...');
  
  const connections = [];
  
  // Create some sample relationships
  // These are fictitious for demo purposes
  const connectionPatterns = [
    // Sample relationships
    { from: 0, to: 10, type: 'sample', confidence: 0.95 },
    { from: 1, to: 11, type: 'sample', confidence: 0.88 },
    { from: 2, to: 12, type: 'interpolation', confidence: 0.92 },
    
    // Cover relationships
    { from: 3, to: 13, type: 'cover', confidence: 1.0 },
    { from: 4, to: 14, type: 'cover', confidence: 1.0 },
    
    // Remix relationships
    { from: 5, to: 15, type: 'remix', confidence: 0.85 },
    { from: 6, to: 16, type: 'remix', confidence: 0.90 },
    
    // Inspiration (more chains)
    { from: 7, to: 17, type: 'inspiration', confidence: 0.75 },
    { from: 8, to: 18, type: 'sample', confidence: 0.93 },
    { from: 9, to: 19, type: 'interpolation', confidence: 0.87 },
  ];

  for (const pattern of connectionPatterns) {
    if (tracks[pattern.from] && tracks[pattern.to]) {
      connections.push({
        from_track_id: tracks[pattern.from].id,
        to_track_id: tracks[pattern.to].id,
        connection_type: pattern.type,
        confidence: pattern.confidence,
        evidence_text: `Seed data connection: ${tracks[pattern.to].title} ${pattern.type}s ${tracks[pattern.from].title}`,
      });
    }
  }

  if (connections.length > 0) {
    const { error } = await supabase
      .from('track_connections')
      .insert(connections);

    if (error) {
      console.error('❌ Failed to insert connections:', error.message);
    } else {
      console.log(`✅ Created ${connections.length} connections`);
    }
  }
}

/**
 * Main seed function
 */
async function seed() {
  console.log('🌱 Starting database seed...\n');

  const shouldReset = process.argv.includes('--reset');
  
  if (shouldReset) {
    await clearData();
  }

  // Insert tracks
  console.log('📀 Inserting tracks...');
  const insertedTracks = [];
  
  for (let i = 0; i < seedTracksWithProviders.length; i++) {
    const track = await insertTrack(seedTracksWithProviders[i], i);
    if (track) {
      insertedTracks.push(track);
      if ((i + 1) % 10 === 0) {
        console.log(`   ${i + 1}/${seedTracksWithProviders.length} tracks inserted`);
      }
    }
  }
  
  console.log(`✅ Inserted ${insertedTracks.length} tracks\n`);

  // Create connections
  if (insertedTracks.length >= 20) {
    await createConnections(insertedTracks);
  }

  console.log('\n🎉 Seeding complete!');
  console.log(`   📊 Total tracks: ${insertedTracks.length}`);
  console.log(`   🔗 Total connections: ~${Math.min(10, Math.floor(insertedTracks.length / 2))}`);
}

// Run seed
seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  });
