/*
  db.js - Vanilla JS code for managing costs in LocalStorage.
  Core database library for the Cost Manager application.
  Manages LocalStorage operations, data validation, and currency conversions.
  Works as an independent module and exposes the global 'db' object.
*/

(function () {
    'use strict';

    // Supported currencies for the application
    const currenciesSupported = ['USD', 'ILS', 'GBP', 'EURO'];

    // LocalStorage key for saving the rates URL
    const urlStorageName = 'exchangeRatesUrl';

    /*
      This object holds the active exchange rates, starting with hardcoded backups.
      The application still prioritizes fetching rates from the required default URL or the user custom one.
      These initial values serve exclusively as a safety net if all network fetch attempts fail.
      Once a network request succeeds, setExchangeRates dynamically overwrites these values.
    */
    const currentRates = {
        "USD": 1,
        "GBP": 0.6,
        "EURO": 0.7,
        "ILS": 3.4
    };

    /*
      Checks if the provided currency is in the supported list.
      Returns a boolean (true if supported, false otherwise).
    */
    function isCurrencySupported(currency) {
        // Return boolean based on inclusion in supported currencies list
        return currenciesSupported.includes(currency);
    }

    /*
      Converts a given sum from one currency to another using the active exchange rates.
      Returns the converted sum as a number.
    */
    function convertCurrency(sum, originalCurrency, targetCurrency) {
        // If the source and target currencies are identical, no conversion is needed
        if (originalCurrency === targetCurrency) {
            return sum;
        }

        // Normalize the amount to a base currency (USD) first, and then convert it to the target currency
        const sumInBaseCurrency = sum / currentRates[originalCurrency];
        return sumInBaseCurrency * currentRates[targetCurrency];
    }

    /*
      Validates that the cost object contains all required fields with correct types.
      Returns nothing, but throws an Error if validation fails.
    */
    function validateAddCost(cost){
        // Ensure the input is a valid object and not null
        if(cost === null || typeof cost !== 'object'){
            throw new Error('Cost is not an object');
        }

        // Validate that the sum is a valid positive number
        if(typeof cost.sum !== 'number' || isNaN(cost.sum) || cost.sum <= 0){
            throw new Error('New cost sum is not a positive number');
        }

        // Verify currency is valid against our currencies list
        if(typeof cost.currency !== 'string' || !isCurrencySupported(cost.currency)){
            throw new Error('New cost currency is not a string of one of the supported currencies');
        }

        // Check if category is non-empty string
        if(typeof cost.category !== 'string' || cost.category.trim() === ''){
            throw new Error('New cost category must be a non-empty string');
        }

        // Check if description is non-empty string
        if(typeof cost.description !== 'string' || cost.description.trim() === ''){
            throw new Error('New cost description must be a non-empty string');
        }
    }

    /*
      Validates the parameters needed for generating a report.
      Returns nothing, but throws an Error if any parameter is invalid.
    */
    function validateGetReport(currency, year, month){
        // Ensure the requested currency is supported
        if(typeof currency !== 'string' || !isCurrencySupported(currency)){
            throw new Error('Report currency is not a string of one of the supported currencies');
        }

        // Ensure the year is a positive integer
        if(!Number.isInteger(year) || year <= 0){
            throw new Error('Report year must be a positive integer');
        }

        // Validate the month is within the standard 1-12 range and an integer
        if(!Number.isInteger(month) || month < 1 || month > 12){
            throw new Error('Report month must be a integer between 1 and 12');
        }
    }

    /*
      Retrieves costs from LocalStorage and parses them.
      Returns an array of costs, or an empty array if invalid/not found.
    */
    function getCostsFromStorage(dbName){
        try {
            // Attempt to get and parse the data from local storage
            const storedData = localStorage.getItem(dbName);
            if(!storedData){
                return [];
            }

            // Parse the JSON string into an object
            const parsedData = JSON.parse(storedData);

            // Guard against structural tampering (like manual edits via DevTools)
            // Falling back to an empty array prevents array method crashes in the UI
            if(!Array.isArray(parsedData)){
                // Silent recovery: log the error and return [] so the dashboard safely renders
                console.error('Database corruption detected: Data is not an array');
                return [];
            }

            // Return the successfully validated data array
            return parsedData;
        }
        catch(error){
            // Handle blocked storage access or other errors without breaking the app
            // Silent recovery: log the error and return [] so the dashboard safely renders
            console.error(`Storage error: ${error.message}`);
            return [];
        }
    }

    /*
      Saves the provided costs array into LocalStorage as a JSON string.
      Returns nothing.
    */
    function setCostsToStorage(dbName, costs){
        // Stringify the costs array and save to local storage
        localStorage.setItem(dbName, JSON.stringify(costs));
    }

    /*
      Calculates the current date and formats it into an object.
      Returns an object containing the current day, month, and year.
    */
    function getCurrentDate(){
        // Get the current date
        const nowDate = new Date();

        // Month is zero-indexed, so we add 1 for correct representation
        return {
            day: nowDate.getDate(),
            month: nowDate.getMonth() + 1,
            year: nowDate.getFullYear()
        };
    }

    /*
      Initializes the database if needed and establishes a connection.
      Returns an object exposing the addCost and getReport methods.
    */
    function openCostsDB(databaseName, databaseVersion){
        // Check if database name is non-empty string
        if(typeof databaseName !== 'string' || databaseName.trim() === ''){
            throw new Error('DB name must be a non-empty string');
        }

        // Validate that the database version is a valid number type
        if(typeof databaseVersion !== 'number'){
            throw new Error('DB version must be a positive number');
        }

        // Initialize with an empty array if the database is newly created
        if(localStorage.getItem(databaseName) === null){
            setCostsToStorage(databaseName, []);
        }

        return {
            /*
              Validates and saves a new cost item to LocalStorage, appending the date.
              Returns the inserted cost object (excluding the date field).
            */
            addCost: function(cost){
                // Validate incoming cost object properties
                validateAddCost(cost);

                // Get the current costs data and the current date
                const currCostsData = getCostsFromStorage(databaseName);
                const nowDate = getCurrentDate();

                // Construct the full cost object including the current date
                const newCost = {
                    sum : cost.sum,
                    currency: cost.currency,
                    category: cost.category,
                    description: cost.description,
                    date: nowDate
                };

                // Add the new cost to the array and save back to storage
                currCostsData.push(newCost);
                setCostsToStorage(databaseName, currCostsData);

                // Return the inserted cost
                return {
                    sum: cost.sum,
                    currency: cost.currency,
                    category: cost.category,
                    description: cost.description
                };
            },

            /*
              Generates a monthly report with costs converted to the requested currency.
              Returns an object containing year, month, formatted costs array, and total sum.
            */
            getReport: function (currency, year, month){
                // Get the current costs data and the current date
                const costs = getCostsFromStorage(databaseName);
                const nowDate = getCurrentDate();

                // Fallback to current year and month if not explicitly provided
                const targetYear = year !== undefined ? year : nowDate.year;
                const targetMonth = month !== undefined ? month : nowDate.month;

                // Validate the report parameters
                validateGetReport(currency, targetYear, targetMonth);

                // Initialize accumulator for total sum and array for filtered costs
                let totalSum = 0;
                const reportCosts = [];

                // Iterate through all costs and filter by the requested time frame
                costs.forEach(cost => {
                    // Filter the costs by year and month that requested
                    if(cost.date.year === targetYear && cost.date.month === targetMonth){
                        // Convert the sum to the requested currency using the helper function
                        const convertedSum = convertCurrency(cost.sum, cost.currency, currency);
                        totalSum += convertedSum;

                        // Append the filtered cost to the report array
                        reportCosts.push({
                            sum: cost.sum,
                            currency: cost.currency,
                            category: cost.category,
                            description: cost.description,
                            // Adding the date attribute in the requested format
                            date: {
                              day: cost.date.day
                            }
                        });
                    }
                });

                // Return the finalized report structure
                return {
                    year: targetYear,
                    month: targetMonth,
                    costs: reportCosts,
                    // Attach the calculated total object (requested currency and total sum)
                    total: {
                       currency: currency,
                       sum: totalSum
                    }
                };
            },

            /*
              Generates a yearly report with total costs grouped by month.
              Returns an array of 12 numbers representing the totals from Jan to Dec.
            */
            getYearlyReport: function (currency, year){
                // Get the current costs data from local storage
                const costs = getCostsFromStorage(databaseName);

                // Fallback to the current year if not explicitly provided
                const targetYear = year !== undefined ? year : getCurrentDate().year;

                // Validate that the requested currency is supported
                if(typeof currency !== 'string' || !isCurrencySupported(currency)){
                    throw new Error('Report currency is not a string of one of the supported currencies');
                }

                // Validate that the target year is a positive integer
                if(!Number.isInteger(targetYear) || targetYear <= 0){
                    throw new Error('Report year must be a positive integer');
                }

                // Initialize an array of 12 zeros to represent the total sum of each month
                const monthlyTotals = [0, 0, 0, 0, 0, 0 ,0, 0, 0, 0, 0, 0];

                // Iterate through all costs to accumulate the sums for the target year
                costs.forEach(cost => {
                    // Filter costs by the requested year
                    if(cost.date.year === targetYear){
                        // Convert the cost sum to the requested currency using the helper function
                        const convertedSum = convertCurrency(cost.sum, cost.currency, currency);

                        // Add the converted sum to the month index (0 for Jan, 11 for Dec)
                        monthlyTotals[cost.date.month - 1] += convertedSum;
                    }
                });

                return monthlyTotals;
            },

            /*
              Generates a monthly report grouped by category.
              Returns an object where keys are categories and values are the total sums in the requested currency.
            */
            getMonthlyByCategoryReport: function (currency, year, month) {
                // Get the current costs data and the current date
                const costs = getCostsFromStorage(databaseName);
                const nowDate = getCurrentDate();

                // Fallback to current year and month if not explicitly provided
                const targetYear = year !== undefined ? year : nowDate.year;
                const targetMonth = month !== undefined ? month : nowDate.month;

                // Validate the report parameters using the existing helper function
                validateGetReport(currency, targetYear, targetMonth);

                // Initialize an empty object to hold the total sum per category
                const chartCategories = {};

                // Iterate through all costs to accumulate the sums for the target month and year
                costs.forEach(cost => {
                    // Filter the costs by the specific year and month requested
                    if (cost.date.year === targetYear && cost.date.month === targetMonth) {
                        // Convert the cost sum to the requested currency using the helper function
                        const convertedSum = convertCurrency(cost.sum, cost.currency, currency);

                        // Add the converted sum to the specific category, initializing it to 0 if it doesn't exist yet
                        chartCategories[cost.category] = (chartCategories[cost.category] || 0) + convertedSum;
                    }
                });

                return chartCategories;
            }
        }
    }

    // Expose the database methods to the global window object
    window.db = {
        openCostsDB: openCostsDB,

        /*
          Saves a custom URL for fetching exchange rates into LocalStorage.
          Returns nothing.
        */
        setRatesUrl: function(url){
            // Ensure url string is valid and not empty
            if (typeof url === 'string' && url.trim() !== ''){
                // Save the URL to local storage
                localStorage.setItem(urlStorageName, url);
            }
            else{
                // Throw error for invalid input
                throw new Error('URL must be a non-empty string');
            }
        },

        /*
          Retrieves the custom URL for exchange rates from LocalStorage.
          Returns the saved URL as a string, or null if it doesn't exist.
        */
        getRatesUrl: function () {
            return localStorage.getItem(urlStorageName);
        },

        /*
          Updates the internal exchange rates object based on the fetched data.
          Returns nothing.
        */
        setExchangeRates: function(rates){
            // Validate incoming rates object
            if (!rates || typeof rates !== 'object') {
                // Throw error for invalid object
                throw new Error('Rates must be a valid object');
            }

            /*
              We intentionally avoid throwing an error if a specific currency is missing or invalid in the fetched data.
              This design choice ensures fault tolerance and allows partial updates.
              valid rates from the server are successfully applied, while missing ones
              safely retain their previous or hardcoded fallback values without crashing the application.
            */
            currenciesSupported.forEach(currency => {
                // Check if currency exists in object and is a valid number
                if (typeof rates[currency] === 'number' && rates[currency] > 0) {
                    currentRates[currency] = rates[currency];
                }
            });
        },

        /*
          Provides access to the currently loaded exchange rates.
          Returns a copy of the current exchange rates object.
        */
        getExchangeRates: function () {
            // Return cloned object to prevent unintended mutations
            return { ...currentRates };
        }

    };
})();