/*
  app.js
  Main frontend application logic for the Cost Manager.
  Handles DOM manipulation, event listeners, form submissions, API calls for rates,
  and renders dynamic data into tables and Chart.js components.
*/

// Set up constants for the app
const dbName = 'costsdb';
const defaultCurrency = 'USD';
const ratesFetchInterval = 1000 * 60 * 60;
const ratesDefaultUrl = 'https://cost-manager-8vp7.onrender.com/rates.json';

/*
  Function triggered by the 'DOMContentLoaded' event listener.
  Initialize the application and UI state when the DOM is ready.
  Sets up the database connection, initial state, and begins data fetching.
*/
document.addEventListener('DOMContentLoaded', async () => {

    // Define the database variable
    let costsDatabase;

    // Attempt to open the local database and handle errors gracefully
    try{
        costsDatabase = db.openCostsDB(dbName, 1);
    }
    catch(error){
        alert(`Failed to open database: ${error.message}`);
    }

    // Manage application state in a centralized object
    const appState = {
        costsDatabase: costsDatabase,
        pieChart: null,
        barChart: null
    };

    // Pre-fill the filter form with the current year and month
    const nowDate = new Date();
    document.getElementById('filterYear').value = String(nowDate.getFullYear());
    document.getElementById('filterMonth').value = String(nowDate.getMonth() + 1);

    // Load any previously saved custom URL into the settings input
    const savedUrl = db.getRatesUrl();
    if(savedUrl){
        document.getElementById('ratesUrl').value = savedUrl;
    }

    // Flag to prevent overlapping fetch requests
    let isFetchingRates = false;

    // Perform the initial rates fetch before setting up the dashboard
    try{
        await fetchRates();
    }
    catch(error){
        // Alert the user that initial fetch failed
        alert(`Initial fetch failed: ${error.message}, Relying on cached rates`);
    }

    setupEventListeners(appState);
    updateDashboard(appState);

    // Schedule periodic fetching to get the most up-to-date exchange rates
    setInterval(async () => {
        // Exit if a fetch is already in progress
        if(isFetchingRates) return;

        isFetchingRates = true;

        // Fetch rates and update dashboard only if the fetching was successful to avoid redundant re-rendering
        try{
            await fetchRates();
            updateDashboard(appState);
            console.log('Rates updated automatically');
        }
        catch(error){
            // Print an error to the console
            // We're not using here alert to prevent disrupting the user's experience during automatic background update
            console.error(`Background fetch failed: ${error.message}, relying on cached rates`);
        }
        isFetchingRates = false;

    }, ratesFetchInterval);

});

/*
  Fetches exchange rates from the configured URL or default URL.
  Returns a Promise that resolves when the fetch is complete.
*/
async function fetchRates(){
    // Retrieve the URL from local storage
    let fetchUrl = db.getRatesUrl();

    // Revert to the default local rates if no custom URL is provided
    if(!fetchUrl){
        fetchUrl = ratesDefaultUrl;
    }

    // Await the response from the fetch call
    const response = await fetch(fetchUrl);

    // Only update rates if the response from the server is successful
    if(response.ok){
        const rates = await response.json();
        db.setExchangeRates(rates);
        console.log('Rates loaded successfully from server');
    }
    else{
        // Throw an error if the server response is not ok, to be handled by the function caller
        throw new Error('Invalid URL or Server Error');
    }
}

/*
  Binds event listeners to forms and buttons across the application.
  Returns nothing.
*/
function setupEventListeners(appState) {
    // Add event listener for the add cost form submission
    document.getElementById('addCostForm').addEventListener('submit', event => handleAddCost(event, appState));

    // Add event listener for changes in the report filter form
    document.getElementById('reportForm').addEventListener('input', () => updateDashboard(appState));

    // Add event listener for saving the settings URL
    document.getElementById('saveSettings').addEventListener('click', () => handleSaveSettings(appState));
}

/*
  Handles the logic for extracting form data and saving a new cost.
  Returns nothing.
*/
function handleAddCost(event, appState){
    // Prevent the default form submission
    event.preventDefault();

    // Extract values from the input elements
    const cost = {
        // Parse the sum string into a float
        sum: parseFloat(document.getElementById('sum').value),
        currency: document.getElementById('currency').value,
        category: document.getElementById('category').value,
        description: document.getElementById('description').value
    };

    try{
        // Add the cost to the database and trigger a UI refresh
        appState.costsDatabase.addCost(cost);
        resetCostForm();
        updateDashboard(appState);
        alert('Cost added successfully');
    }
    catch(error){
        // Show an alert if validation fails
        alert(`Failed to add cost: ${error.message}`);
    }

}

/*
  Clears the input fields in the add cost form.
  Returns nothing.
*/
function resetCostForm(){
    // Clear sum, category, description input and reset currency to default
    document.getElementById('sum').value = '';
    document.getElementById('currency').value = defaultCurrency;
    document.getElementById('category').value = '';
    document.getElementById('description').value = '';
}

/*
  Saves user-defined URL settings and re-fetches the exchange rates.
  Returns a Promise.
*/
async function handleSaveSettings(appState){
    // Get the trimmed URL from the input
    let url = document.getElementById('ratesUrl').value.trim();

    // Reset to default URL if the user submits an empty string
    if(url === ''){
        url = ratesDefaultUrl;
        document.getElementById('ratesUrl').value = url;
        alert('No URL provided. Reverting to default URL');
    }

    try{
        // Save the setting and update the dashboard once the new rates are fetched
        db.setRatesUrl(url);
        await fetchRates();
        updateDashboard(appState);
        alert('Settings saved and Rates updated!');
    }
    catch(error){
        // Alert the user if fetching from the new URL fails
        alert(`Failed to fetch rates: ${error.message}, Relying on cached rates`);
    }
}

/*
  Renders the report table and charts based on the currently applied filters.
  Returns nothing.
*/
function updateDashboard(appState){
    // Parse filter year and month
    const year = parseInt(document.getElementById('filterYear').value);
    const month = parseInt(document.getElementById('filterMonth').value);

    const currency = document.getElementById('filterCurrency').value;

    // Prevent rendering if any of the required filter fields are empty
    if(!year || !month || !currency) return;

    try{
        // Generate and render the detailed monthly report table
        const report = appState.costsDatabase.getReport(currency, year, month);
        renderReport(report);

        // Generate categorized data and render pie chart
        const monthByCategoryReport = appState.costsDatabase.getMonthlyByCategoryReport(currency, year, month);
        renderPieChart(monthByCategoryReport, appState);

        // Generate yearly data and render bar chart
        const yearlyReport = appState.costsDatabase.getYearlyReport(currency, year);
        renderBarChart(yearlyReport, currency, appState);
    }
    catch(error){
        // Alert the user if data retrieval or dashboard rendering fails
        alert(`Failed to update dashboard: ${ error.message}`);
    }
}

/*
  Renders the report data into the HTML table structure and handles empty states.
  Returns nothing.
*/
function renderReport(report){
    // Get the table body element
    const tableBody = document.querySelector('#reportTable tbody');

    // Clear existing table content before rendering new data
    tableBody.innerHTML = '';

    // Display an empty state message if no costs are found
    if (report.costs.length === 0) {
        // Create an empty row
        const emptyRow = document.createElement('tr');

        // Add the empty message cell
        emptyRow.innerHTML = `
            <td colspan="4" class="no-costs-message">
                No costs found for this month and year
            </td>
        `;

        // Append the empty message row to the table body
        tableBody.appendChild(emptyRow);
    }
    else{
        // Iterate through costs and construct table rows
        report.costs.forEach(cost => {
            // Create a new row for each cost
            const newRow = document.createElement('tr');

            // Inject the cost data into the row
            newRow.innerHTML = `
            <td>${cost.date.day}/${report.month}/${report.year}</td>
            <td>${cost.category}</td>
            <td>${cost.description}</td>
            <td>${cost.sum} ${cost.currency}</td>
            `;

            // Append the new row to the table body
            tableBody.appendChild(newRow);
        });
    }

    // Update the total sum display below the table
    document.getElementById('totalReportSum').innerText = `Total: ${report.total.sum.toFixed(2)} ${report.total.currency}`;
}

/*
  Renders the pie chart aggregating costs by category.
  Returns nothing.
*/
function renderPieChart(monthByCategory, appState){
    // Define a list of colors for the pie chart
    const chartColors = ['#1e40af', '#3b82f6', '#9ca3af', '#111827', '#06b6d4', '#4b5563', '#93c5fd'];

    // Get references to DOM elements
    const emptyMsg = document.getElementById('pieChartEmptyMsg');
    const canvas = document.getElementById('pieChart');

    // Check if the monthlyByCategoryReport object has no keys (means is empty)
    if (Object.keys(monthByCategory).length === 0) {
        // If true show empty message and hide canvas
        emptyMsg.style.display = 'block';
        canvas.style.display = 'none';
        if(appState.pieChart) appState.pieChart.destroy();
        return;
    }

    // Restore canvas visibility if data is present
    emptyMsg.style.display = 'none';
    canvas.style.display = 'block';

    // Get the canvas context for the pie chart
    const pieChartContext = document.getElementById('pieChart').getContext('2d');

    // Destroy previous chart instance to avoid rendering overlaps
    if(appState.pieChart) appState.pieChart.destroy();

    // Create the chart object
    appState.pieChart = new Chart(pieChartContext, {
        // Define chart type
        type: 'pie',
        data: {
           // Provide labels from category keys
           labels: Object.keys(monthByCategory),
           datasets: [{
               // Extract the chart values data
               data: Object.values(monthByCategory),
               // Apply chart colors
               backgroundColor: chartColors
           }]
        },
        options: {maintainAspectRatio: false}
    });
}

/*
  Renders the bar chart showing total costs across all 12 months of the year.
  Returns nothing.
*/
function renderBarChart(monthlyTotals, currency, appState){
    // Define the month names and the main chart color
    const monthsNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const chartColor = '#1e40af';

    // Get the canvas context for the bar chart
    const barChartContext = document.getElementById('barChart').getContext('2d');

    // Destroy previous chart instance to avoid rendering overlaps
    if(appState.barChart) appState.barChart.destroy();

    // Create the chart object
    appState.barChart = new Chart(barChartContext, {
        // Define chart type
        type: 'bar',
        data: {
           // Set the 12 months names as X axis labels
           labels: monthsNames,
           datasets: [{
               // Set the label for the bar dataset
               label: `Total Costs in ${currency}`,
               // Provide the 12 monthly totals data
               data: monthlyTotals,
               // Apply primary color to bars
               backgroundColor: chartColor
           }]
        },
        options: {maintainAspectRatio: false}
    });
}
