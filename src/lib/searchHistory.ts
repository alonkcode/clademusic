/**
 * Search History Utility
 * 
 * Manages search history in localStorage
 */

import { Track } from '@/types';

const HISTORY_KEY = 'clade_search_history';
const MAX_HISTORY_ITEMS = 20;

export interface SearchHistoryItem {
  id: string;
  query: string;
  type: 'song' | 'chord';
  track?: Track; // Store track if it was a song search result
  timestamp: number;
}

export function getSearchHistory(): SearchHistoryItem[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) return [];
    
    const history: SearchHistoryItem[] = JSON.parse(stored);
    // Sort by most recent first
    return history.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Error loading search history:', error);
    return [];
  }
}

export function addToSearchHistory(item: Omit<SearchHistoryItem, 'id' | 'timestamp'>) {
  try {
    const history = getSearchHistory();

    // A repeat of a recent search updates that entry in place - moved to the
    // front with a fresh timestamp, and gaining a track if this call has one
    // and the earlier one didn't (typing "shape of you" records the query,
    // then clicking a result attaches the track to that same entry) - rather
    // than being silently dropped, which is what made a search you'd already
    // made once look like it was never recorded at all.
    const dupIndex = history.findIndex(
      (h) => h.query.toLowerCase() === item.query.toLowerCase() && h.type === item.type
    );

    const merged: SearchHistoryItem = {
      id: dupIndex >= 0 ? history[dupIndex].id : `${Date.now()}-${Math.random()}`,
      query: item.query,
      type: item.type,
      track: item.track ?? (dupIndex >= 0 ? history[dupIndex].track : undefined),
      timestamp: Date.now(),
    };

    const rest = dupIndex >= 0 ? history.filter((_, i) => i !== dupIndex) : history;

    // Add to beginning and limit size
    const updatedHistory = [merged, ...rest].slice(0, MAX_HISTORY_ITEMS);

    localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
  } catch (error) {
    console.error('Error saving search history:', error);
  }
}

export function removeFromHistory(id: string) {
  try {
    const history = getSearchHistory();
    const filtered = history.filter(item => item.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error removing from search history:', error);
  }
}

export function clearSearchHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (error) {
    console.error('Error clearing search history:', error);
  }
}
