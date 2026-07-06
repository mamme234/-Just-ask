// ================= MEDIA DATABASE =================
// All movies, TV series, K-Dramas, Anime, and more with TMDB IDs

import { turkishSeries } from './turkish.js';
import { kdramas } from './kdrama.js';
import { anime } from './anime.js';
import { americanMovies, americanTV } from './american.js';
import { indianMovies } from './indian.js';
import { arabicSeries } from './arabic.js';
import { koreanMovies } from './korean.js';
import { japaneseMovies } from './japanese.js';
import { europeanMovies } from './european.js';

// TMDB Configuration
export const TMDB_CONFIG = {
  apiKey: process.env.TMDB_API_KEY || 'your_tmdb_api_key',
  baseUrl: 'https://image.tmdb.org/t/p/w500',
  apiUrl: 'https://api.themoviedb.org/3'
};

export const MEDIA_DB = {
  turkish: turkishSeries,
  kdrama: kdramas,
  anime: anime,
  americanMovies: americanMovies,
  americanTV: americanTV,
  indian: indianMovies,
  arabic: arabicSeries,
  korean: koreanMovies,
  japanese: japaneseMovies,
  european: europeanMovies
};

// Get all media by category
export function getMediaByCategory(category) {
  const categories = {
    turkish: turkishSeries,
    kdrama: kdramas,
    anime: anime,
    americanMovies: americanMovies,
    americanTV: americanTV,
    indian: indianMovies,
    arabic: arabicSeries,
    korean: koreanMovies,
    japanese: japaneseMovies,
    european: europeanMovies
  };
  return categories[category] || [];
}

// Get all media combined
export function getAllMedia() {
  return {
    turkish: turkishSeries,
    kdrama: kdramas,
    anime: anime,
    americanMovies: americanMovies,
    americanTV: americanTV,
    indian: indianMovies,
    arabic: arabicSeries,
    korean: koreanMovies,
    japanese: japaneseMovies,
    european: europeanMovies
  };
}

// Count all media
export function getMediaCount() {
  return {
    turkish: turkishSeries.length,
    kdrama: kdramas.length,
    anime: anime.length,
    americanMovies: americanMovies.length,
    americanTV: americanTV.length,
    indian: indianMovies.length,
    arabic: arabicSeries.length,
    korean: koreanMovies.length,
    japanese: japaneseMovies.length,
    european: europeanMovies.length,
    total: turkishSeries.length + kdramas.length + anime.length + americanMovies.length + americanTV.length + indianMovies.length + arabicSeries.length + koreanMovies.length + japaneseMovies.length + europeanMovies.length
  };
    }
