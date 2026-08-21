/*
 * Cost Manager - vanilla db.js
 * Loaded via <script src="db.js">, assigns a global `db` object.
 * See /planning/db-architecture.md for the full design and public API.
 *
 * This is the single source of truth for the DB logic. The ESM adapter used
 * by the React app (src/db/db.module.js) re-exports window.db and contains
 * no logic of its own, so the two never drift apart.
 */
(function (global) {
  'use strict';

  var CURRENCIES = ['USD', 'ILS', 'GBP', 'EURO'];

  // Deployed rates.json - see planning/db-architecture.md §4.
  var DEFAULT_RATES_URL = 'https://cost-manager-frontend-project.onrender.com/rates.json';

  // Bottom of the rates cache chain - always available, no network needed.
  var FALLBACK_RATES = { USD: 1, GBP: 0.6, EURO: 0.7, ILS: 3.4 };

  var RATES_CACHE_KEY = 'costmanager.ratesCache';
  var SETTINGS_KEY = 'costmanager.settings';
  var RATES_TTL_MS = 60 * 60 * 1000; // 1 hour
  var FETCH_TIMEOUT_MS = 8000;

  // Schema migrations, keyed by the version they migrate TO. Empty today;
  // the hook exists so a future schema change never orphans stored data.
  var MIGRATIONS = {};

  // In-memory fallback so db.js still works under file://, Incognito, or
  // with site data blocked, where localStorage access can throw.
  var memoryStore = {};

  // In-memory mirror of the last rates cache entry read or written this
  // page load - the first layer of the §4 cache chain.
  var memoryRatesCache = null;

  function storageGet(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    }
  }

  function storageSet(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (e) {
      memoryStore[key] = value;
    }
  }

  function storageRemove(key) {
    try {
      global.localStorage.removeItem(key);
    } catch (e) {
      delete memoryStore[key];
    }
  }

  function readJSON(key, fallback) {
    var raw = storageGet(key);
    if (raw === null || raw === undefined) {
      return fallback;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    storageSet(key, JSON.stringify(value));
  }

  function metaKey(name) {
    return name + '.meta';
  }

  function costsKey(name) {
    return name + '.costs';
  }

  function loadMeta(name) {
    return readJSON(metaKey(name), null);
  }

  function saveMeta(name, meta) {
    writeJSON(metaKey(name), meta);
  }

  function loadCosts(name) {
    return readJSON(costsKey(name), []);
  }

  function saveCosts(name, costs) {
    writeJSON(costsKey(name), costs);
  }

  function loadSettings() {
    return readJSON(SETTINGS_KEY, {});
  }

  function saveSettings(settings) {
    writeJSON(SETTINGS_KEY, settings);
  }

  function isHttpUrl(url) {
    return /^https?:\/\//i.test(url);
  }

  function getRatesUrl() {
    var settings = loadSettings();
    if (settings && typeof settings.ratesUrl === 'string' && settings.ratesUrl) {
      return settings.ratesUrl;
    }
    return DEFAULT_RATES_URL;
  }

  function clearRatesCache() {
    memoryRatesCache = null;
    storageRemove(RATES_CACHE_KEY);
  }

  function setRatesUrl(url) {
    var trimmed = typeof url === 'string' ? url.trim() : '';
    var settings = loadSettings();

    if (trimmed === '') {
      delete settings.ratesUrl;
    } else {
      if (!isHttpUrl(trimmed)) {
        throw new Error('setRatesUrl: url must start with http:// or https://.');
      }
      settings.ratesUrl = trimmed;
    }

    saveSettings(settings);
    // the old URL's cached rates don't apply to the new URL
    clearRatesCache();
  }

  function isFreshCacheEntry(entry) {
    return !!entry && typeof entry.fetchedAt === 'number' && (Date.now() - entry.fetchedAt) < RATES_TTL_MS;
  }

  // Synchronous. Walks memory -> localStorage (if still fresh) -> hard-coded
  // fallback, per planning/db-architecture.md §4. This is what lets
  // getReport stay synchronous while still reflecting fetched rates.
  function getCachedRates() {
    if (memoryRatesCache) {
      return memoryRatesCache.rates;
    }

    var stored = readJSON(RATES_CACHE_KEY, null);
    if (isFreshCacheEntry(stored)) {
      memoryRatesCache = stored;
      return stored.rates;
    }

    return FALLBACK_RATES;
  }

  function validateRatesPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Rates payload must be an object.');
    }

    var rates = {};
    for (var i = 0; i < CURRENCIES.length; i++) {
      var code = CURRENCIES[i];
      var value = payload[code];
      if (typeof value !== 'number' || !isFinite(value) || value <= 0) {
        throw new Error('Rates payload is missing a valid value for "' + code + '".');
      }
      rates[code] = value;
    }
    return rates;
  }

  function fetchRates(url) {
    return new Promise(function (resolve, reject) {
      var fetchFn = global.fetch;
      if (typeof fetchFn !== 'function') {
        reject(new Error('fetch is not available in this environment.'));
        return;
      }

      var controller = (typeof global.AbortController === 'function') ? new global.AbortController() : null;
      var timedOut = false;
      var timeoutId = setTimeout(function () {
        timedOut = true;
        if (controller) {
          controller.abort();
        }
      }, FETCH_TIMEOUT_MS);

      fetchFn(url, controller ? { signal: controller.signal } : undefined)
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Rates request failed with status ' + response.status + '.');
          }
          return response.json();
        })
        .then(function (payload) {
          clearTimeout(timeoutId);
          resolve(validateRatesPayload(payload));
        })
        .catch(function (err) {
          clearTimeout(timeoutId);
          if (timedOut || (err && err.name === 'AbortError')) {
            reject(new Error('Rates request to "' + url + '" timed out.'));
          } else {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
    });
  }

  // Async, never rejects - see planning/db-architecture.md §4. Any failure
  // resolves with the best rates already available plus a populated `error`.
  function getExchangeRates(options) {
    options = options || {};
    var force = !!options.force;
    var url = getRatesUrl();

    if (!force) {
      var existing = memoryRatesCache || readJSON(RATES_CACHE_KEY, null);
      if (isFreshCacheEntry(existing) && existing.url === url) {
        memoryRatesCache = existing;
        return Promise.resolve({
          rates: existing.rates,
          source: 'cache',
          fetchedAt: existing.fetchedAt,
          url: url,
          error: null
        });
      }
    }

    return fetchRates(url).then(
      function (rates) {
        var entry = { url: url, fetchedAt: Date.now(), rates: rates };
        memoryRatesCache = entry;
        writeJSON(RATES_CACHE_KEY, entry);
        return { rates: rates, source: 'network', fetchedAt: entry.fetchedAt, url: url, error: null };
      },
      function (err) {
        var cached = memoryRatesCache || readJSON(RATES_CACHE_KEY, null);
        if (cached && cached.rates) {
          return { rates: cached.rates, source: 'cache', fetchedAt: cached.fetchedAt, url: url, error: err.message };
        }
        return { rates: FALLBACK_RATES, source: 'fallback', fetchedAt: null, url: url, error: err.message };
      }
    );
  }

  function runMigrations(name, meta, requestedVersion) {
    var version = meta.version;
    while (version < requestedVersion) {
      var next = version + 1;
      var migrate = MIGRATIONS[next];
      if (typeof migrate === 'function') {
        var costs = migrate(loadCosts(name));
        saveCosts(name, costs);
      }
      version = next;
    }
    meta.version = version;
    saveMeta(name, meta);
    return meta;
  }

  // Tracks the most recently opened database so the db-level functions
  // (db.addCost, db.getReport) know which store to use.
  var lastOpened = null;

  function openCostsDB(databaseName, databaseVersion) {
    var name = databaseName || 'costsdb';
    var requestedVersion = databaseVersion || 1;

    var meta = loadMeta(name);
    if (!meta) {
      meta = { version: requestedVersion, createdAt: new Date().toISOString(), lastId: 0 };
      saveMeta(name, meta);
      saveCosts(name, []);
    } else if (meta.version < requestedVersion) {
      meta = runMigrations(name, meta, requestedVersion);
    } else if (meta.version > requestedVersion) {
      throw new Error(
        'openCostsDB: stored database "' + name + '" is at version ' + meta.version +
        ', which is newer than the requested version ' + requestedVersion + '.'
      );
    }

    lastOpened = { name: name, version: meta.version };

    return {
      addCost: function (cost) {
        return addCostTo(name, cost);
      },
      getReport: function (currency, year, month) {
        return getReportFrom(name, currency, year, month);
      },
      getReportDetailed: function (currency, year, month) {
        return getReportDetailedFrom(name, currency, year, month);
      },
      getCategoryTotals: function (currency, year, month) {
        return getCategoryTotalsFrom(name, currency, year, month);
      },
      getYearlyTotals: function (currency, year) {
        return getYearlyTotalsFrom(name, currency, year);
      },
      deleteCost: function (id) {
        return deleteCostFrom(name, id);
      },
      clearAll: function () {
        return clearAllFrom(name);
      },
      getAllCosts: function () {
        return getAllCostsFrom(name);
      }
    };
  }

  function ensureOpened() {
    if (!lastOpened) {
      openCostsDB('costsdb', 1);
    }
    return lastOpened.name;
  }

  function validateCost(cost) {
    if (!cost || typeof cost !== 'object') {
      throw new Error('addCost: cost must be an object.');
    }

    var sum = typeof cost.sum === 'string' ? parseFloat(cost.sum) : cost.sum;
    if (typeof sum !== 'number' || !isFinite(sum) || sum <= 0) {
      throw new Error('addCost: sum must be a positive number.');
    }

    if (CURRENCIES.indexOf(cost.currency) === -1) {
      throw new Error('addCost: currency must be one of ' + CURRENCIES.join(', ') + '.');
    }

    var category = typeof cost.category === 'string' ? cost.category.trim() : '';
    if (!category) {
      throw new Error('addCost: category is required.');
    }

    var description = typeof cost.description === 'string' ? cost.description.trim() : '';
    if (!description) {
      throw new Error('addCost: description is required.');
    }

    return { sum: sum, currency: cost.currency, category: category, description: description };
  }

  function addCostTo(name, cost) {
    var validated = validateCost(cost);

    var meta = loadMeta(name) || { version: 1, createdAt: new Date().toISOString(), lastId: 0 };
    var costs = loadCosts(name);

    var nextId = (meta.lastId || 0) + 1;
    var record = {
      id: nextId,
      sum: validated.sum,
      currency: validated.currency,
      category: validated.category,
      description: validated.description,
      date: new Date().toISOString()
    };

    costs.push(record);
    meta.lastId = nextId;

    saveCosts(name, costs);
    saveMeta(name, meta);

    return {
      sum: record.sum,
      currency: record.currency,
      category: record.category,
      description: record.description
    };
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function convert(sum, fromCurrency, toCurrency) {
    if (FALLBACK_RATES[fromCurrency] === undefined) {
      throw new Error('convert: unknown currency "' + fromCurrency + '".');
    }
    if (FALLBACK_RATES[toCurrency] === undefined) {
      throw new Error('convert: unknown currency "' + toCurrency + '".');
    }
    if (fromCurrency === toCurrency) {
      return round2(sum);
    }
    return round2((sum / FALLBACK_RATES[fromCurrency]) * FALLBACK_RATES[toCurrency]);
  }

  function getReportFrom(name, currency, year, month) {
    if (CURRENCIES.indexOf(currency) === -1) {
      throw new Error('getReport: currency must be one of ' + CURRENCIES.join(', ') + '.');
    }

    var now = new Date();
    var targetYear = (year === undefined || year === null) ? now.getFullYear() : year;
    var targetMonth = (month === undefined || month === null) ? (now.getMonth() + 1) : month;

    var rates = getCachedRates();
    var costs = loadCosts(name);
    var matching = [];
    var totalRaw = 0; // accumulated unrounded so rows always sum to the displayed total

    for (var i = 0; i < costs.length; i++) {
      var cost = costs[i];
      var costDate = new Date(cost.date);
      if (costDate.getFullYear() === targetYear && (costDate.getMonth() + 1) === targetMonth) {
        matching.push({
          sum: cost.sum,
          currency: cost.currency,
          category: cost.category,
          description: cost.description,
          date: { day: costDate.getDate() }
        });
        totalRaw += (cost.sum / rates[cost.currency]) * rates[currency];
      }
    }

    return {
      year: targetYear,
      month: targetMonth,
      costs: matching,
      total: { currency: currency, sum: round2(totalRaw) }
    };
  }

  function getReportDetailedFrom(name, currency, year, month) {
    if (CURRENCIES.indexOf(currency) === -1) {
      throw new Error('getReportDetailed: currency must be one of ' + CURRENCIES.join(', ') + '.');
    }

    var now = new Date();
    var targetYear = (year === undefined || year === null) ? now.getFullYear() : year;
    var targetMonth = (month === undefined || month === null) ? (now.getMonth() + 1) : month;

    var rates = getCachedRates();
    var costs = loadCosts(name);
    var matching = [];
    var totalRaw = 0;

    for (var i = 0; i < costs.length; i++) {
      var cost = costs[i];
      var costDate = new Date(cost.date);
      if (costDate.getFullYear() === targetYear && (costDate.getMonth() + 1) === targetMonth) {
        var convertedSum = round2((cost.sum / rates[cost.currency]) * rates[currency]);
        matching.push({
          id: cost.id,
          sum: cost.sum,
          currency: cost.currency,
          category: cost.category,
          description: cost.description,
          convertedSum: convertedSum,
          date: {
            day: costDate.getDate(),
            month: costDate.getMonth() + 1,
            year: costDate.getFullYear(),
            iso: cost.date
          }
        });
        totalRaw += (cost.sum / rates[cost.currency]) * rates[currency];
      }
    }

    return {
      year: targetYear,
      month: targetMonth,
      costs: matching,
      total: { currency: currency, sum: round2(totalRaw) }
    };
  }

  function getCategoryTotalsFrom(name, currency, year, month) {
    if (CURRENCIES.indexOf(currency) === -1) {
      throw new Error('getCategoryTotals: currency must be one of ' + CURRENCIES.join(', ') + '.');
    }

    var now = new Date();
    var targetYear = (year === undefined || year === null) ? now.getFullYear() : year;
    var targetMonth = (month === undefined || month === null) ? (now.getMonth() + 1) : month;

    var rates = getCachedRates();
    var costs = loadCosts(name);
    var totalsByCategory = {};
    var order = []; // first-seen order, before sorting by total

    for (var i = 0; i < costs.length; i++) {
      var cost = costs[i];
      var costDate = new Date(cost.date);
      if (costDate.getFullYear() === targetYear && (costDate.getMonth() + 1) === targetMonth) {
        var converted = (cost.sum / rates[cost.currency]) * rates[currency];
        if (!Object.prototype.hasOwnProperty.call(totalsByCategory, cost.category)) {
          totalsByCategory[cost.category] = 0;
          order.push(cost.category);
        }
        totalsByCategory[cost.category] += converted;
      }
    }

    var result = [];
    for (var j = 0; j < order.length; j++) {
      var category = order[j];
      result.push({ category: category, total: round2(totalsByCategory[category]) });
    }
    result.sort(function (a, b) { return b.total - a.total; });

    return result;
  }

  function getYearlyTotalsFrom(name, currency, year) {
    if (CURRENCIES.indexOf(currency) === -1) {
      throw new Error('getYearlyTotals: currency must be one of ' + CURRENCIES.join(', ') + '.');
    }

    var now = new Date();
    var targetYear = (year === undefined || year === null) ? now.getFullYear() : year;

    var rates = getCachedRates();
    var costs = loadCosts(name);
    var totalsRaw = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    for (var i = 0; i < costs.length; i++) {
      var cost = costs[i];
      var costDate = new Date(cost.date);
      if (costDate.getFullYear() === targetYear) {
        var monthIndex = costDate.getMonth(); // 0-based, used only for array indexing
        totalsRaw[monthIndex] += (cost.sum / rates[cost.currency]) * rates[currency];
      }
    }

    var result = [];
    for (var m = 0; m < 12; m++) {
      result.push({ month: m + 1, total: round2(totalsRaw[m]) });
    }
    return result;
  }

  function deleteCostFrom(name, id) {
    var costs = loadCosts(name);
    var index = -1;
    for (var i = 0; i < costs.length; i++) {
      if (costs[i].id === id) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      return false;
    }
    costs.splice(index, 1);
    saveCosts(name, costs);
    return true;
  }

  function clearAllFrom(name) {
    saveCosts(name, []);
    var meta = loadMeta(name);
    if (meta) {
      meta.lastId = 0;
      saveMeta(name, meta);
    }
  }

  function getAllCostsFrom(name) {
    return loadCosts(name);
  }

  var db = {
    CURRENCIES: CURRENCIES,
    DEFAULT_RATES_URL: DEFAULT_RATES_URL,
    openCostsDB: openCostsDB,
    addCost: function (cost) {
      return addCostTo(ensureOpened(), cost);
    },
    getReport: function (currency, year, month) {
      return getReportFrom(ensureOpened(), currency, year, month);
    },
    getReportDetailed: function (currency, year, month) {
      return getReportDetailedFrom(ensureOpened(), currency, year, month);
    },
    getCategoryTotals: function (currency, year, month) {
      return getCategoryTotalsFrom(ensureOpened(), currency, year, month);
    },
    getYearlyTotals: function (currency, year) {
      return getYearlyTotalsFrom(ensureOpened(), currency, year);
    },
    deleteCost: function (id) {
      return deleteCostFrom(ensureOpened(), id);
    },
    clearAll: function () {
      return clearAllFrom(ensureOpened());
    },
    getAllCosts: function () {
      return getAllCostsFrom(ensureOpened());
    },
    convert: convert,
    getExchangeRates: getExchangeRates,
    getCachedRates: getCachedRates,
    getRatesUrl: getRatesUrl,
    setRatesUrl: setRatesUrl
  };

  global.db = db;
})(window);
