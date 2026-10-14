// All pages keep one import; page-init gates their execution on a session.
import './page-init.js';
import { BACKEND } from './config.js';
if (!['local','supabase'].includes(BACKEND)) throw new Error(`Unknown backend: ${BACKEND}`);
const store = await import(BACKEND === 'supabase' ? './store-supabase.js' : './store-local.js');
export const {
  getSettings, saveSettings, getGoalHistory, listEntries, entriesBetween,
  firstLoggedDay, recentEntries, addEntry, updateEntry, deleteEntry,
  listFoods, addFood, updateFood, deleteFood, foodByBarcode, cachedProduct,
  cacheProduct, listDeletedFoods, restoreFood,
  loggedDays, exportAll, listWeights, addWeight, updateWeight, deleteWeight,
  getWeightTrendMethod, setWeightTrendMethod,
} = store;
