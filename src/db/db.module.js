/*
 * ESM adapter over window.db. No logic of its own - see planning/db-architecture.md §1.
 * Requires <script src="db.js"> to have run before this module is imported.
 */
if (!window.db) {
  throw new Error('db.module.js: window.db is undefined - load <script src="db.js"> before importing this module.');
}

export const addCost = window.db.addCost;
export const getReport = window.db.getReport;
export const getReportDetailed = window.db.getReportDetailed;
export const getCategoryTotals = window.db.getCategoryTotals;
export const getYearlyTotals = window.db.getYearlyTotals;
export const deleteCost = window.db.deleteCost;
export const clearAll = window.db.clearAll;
export const getAllCosts = window.db.getAllCosts;
export const convert = window.db.convert;
export const getExchangeRates = window.db.getExchangeRates;
export const getCachedRates = window.db.getCachedRates;
export const getRatesUrl = window.db.getRatesUrl;
export const setRatesUrl = window.db.setRatesUrl;
export const CURRENCIES = window.db.CURRENCIES;
export const DEFAULT_RATES_URL = window.db.DEFAULT_RATES_URL;
