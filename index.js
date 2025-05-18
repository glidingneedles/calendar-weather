// Required Node.js modules
const fs = require("fs");                    // File system module for reading/writing files locally
const readline = require("readline");         // Module for reading user input from terminal
const { google } = require("googleapis");     // Google APIs client library for calendar access
const axios = require("axios");              // HTTP client for making API requests to WeatherAPI
require("dotenv").config();                  // Load environment variables from .env file (contains API keys)
const http = require('http');  // Add HTTP server capability

// Configuration constants
const SCOPES = ["https://www.googleapis.com/auth/calendar"];  // Google Calendar API permission scope
const TOKEN_PATH = "token.json";             // Path to store OAuth2 token after authentication
const UPDATE_INTERVAL = 60 * 60 * 1000;      // Full update interval: 1 hour in milliseconds
const WATCH_INTERVAL = 30 * 60 * 1000;        // Change check interval: 30 minutes in milliseconds

// Global variable for tracking calendar changes
let lastSyncToken = null;                    // Stores sync token to efficiently fetch only changed events

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'healthy',
            lastSync: lastSyncToken ? 'active' : 'pending',
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Calendar Weather Bot Running');
    }
});

// Start HTTP server
const PORT = process.env.PORT || 10000;  // Render will provide PORT environment variable
server.listen(PORT, '0.0.0.0', () => {  // Listen on all network interfaces
    console.log(`Server running on port ${PORT}`);
});

// Initial application setup
// Use credentials from environment variables
const credentials = process.env.GOOGLE_CREDENTIALS ? JSON.parse(process.env.GOOGLE_CREDENTIALS) : null;
const token = process.env.GOOGLE_TOKEN ? JSON.parse(process.env.GOOGLE_TOKEN) : null;

if (!credentials) {
    console.error("No credentials found in environment variables!");
    process.exit(1);
}

// Initialize with credentials from environment
authorize(credentials, startApplication);

/**
 * Create and authorize OAuth2 client
 * @param {Object} credentials The authorization client credentials
 * @param {function} callback The callback to call with the authorized client
 */
function authorize(credentials, callback) {
    // Extract client credentials
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    // Create new OAuth2 client instance
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]
    );

    if (token) {
        // Use token from environment variables
        oAuth2Client.setCredentials(token);
        callback(oAuth2Client);
    } else {
        console.error("No token found in environment variables!");
        process.exit(1);
    }
}

/**
 * Fetch weather forecast information from WeatherAPI.com for a specific date and time
 * @param {Date} eventDate Date object representing the event's start time
 * @returns {Promise<string>} Weather description in format "(condition, temperature°C)"
 */
async function getWeatherInfo(eventDate) {
    try {
        const apiKey = process.env.WEATHERAPI_KEY;
        const city = "Seoul";
        const now = new Date();
        const daysDifference = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));

        // WeatherAPI free tier supports up to 14 days forecast
        if (daysDifference > 14) {
            return "(forecast unavailable)";
        }

        // For future dates, use forecast API
        const url = `http://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${city}&days=${daysDifference + 1}`;
        const res = await axios.get(url);
        
        // Find the forecast for the event date
        const forecast = res.data.forecast.forecastday.find(day => 
            new Date(day.date).toDateString() === eventDate.toDateString()
        );

        if (!forecast) {
            return "(forecast unavailable)";
        }

        // Find the hour closest to the event time
        const eventHour = eventDate.getHours();
        const hourData = forecast.hour.find(h => new Date(h.time).getHours() === eventHour) || forecast.hour[0];

        const condition = hourData.condition.text.toLowerCase();
        const tempC = hourData.temp_c;
        return `(${condition}, ${Math.round(tempC)}°C)`;
    } catch (error) {
        console.error('Weather API Error:', error.message);
        return "(weather unavailable)";
    }
}

/**
 * Update calendar events with weather information for their specific start times
 * @param {google.auth.OAuth2} auth Authorized OAuth2 client
 * @param {string} syncToken Optional token for efficient updates
 */
async function updateCalendarEvents(auth, syncToken = null) {
    const calendar = google.calendar({ version: "v3", auth });

    try {
        // Calculate time range for 7 days
        const timeMin = new Date();
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + 7);  // Add 7 days

        // Parameters for fetching calendar events
        const listParams = {
            calendarId: "primary",           // Use primary calendar
            singleEvents: true,              // Expand recurring events
            orderBy: "startTime",            // Sort by start time
            timeMin: timeMin.toISOString(),  // Start from now
            timeMax: timeMax.toISOString(),  // Up to 7 days from now
        };

        // If we have a sync token, use it to get only changed events
        if (syncToken) {
            listParams.syncToken = syncToken;
            // When using sync token, we can't use timeMin/timeMax
            delete listParams.timeMin;
            delete listParams.timeMax;
        }

        // Fetch events from Google Calendar
        const res = await calendar.events.list(listParams);
        lastSyncToken = res.data.nextSyncToken;  // Save token for next sync

        const events = res.data.items;

        if (!events || events.length === 0) {
            console.log("No events found in the next 7 days.");
            return;
        }

        console.log(`Updating ${events.length} events with weather forecasts...`);
        
        // Process each event
        for (const event of events) {
            const startDateTime = event.start.dateTime || event.start.date;
            const eventDate = new Date(startDateTime);
            
            // Skip events beyond 7 days even if returned by sync token
            if (eventDate > timeMax) {
                continue;
            }

            const weatherDesc = await getWeatherInfo(eventDate);
            
            // Clean the event title by removing existing weather info
            let cleanTitle = event.summary.replace(/\([^)]*\)/g, '').trim();  // Remove anything in parentheses
            cleanTitle = cleanTitle.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();  // Remove any emojis
            
            const newTitle = `${cleanTitle} ${weatherDesc}`;

            // Only update if the title would actually change
            if (newTitle !== event.summary) {
                console.log(`Updating: ${event.summary} → ${newTitle}`);

                // Update the event in Google Calendar
                await calendar.events.patch({
                    calendarId: "primary",
                    eventId: event.id,
                    requestBody: {
                        summary: newTitle,
                    },
                });
            }
        }
        
        console.log("Update completed at:", new Date().toLocaleString());
    } catch (error) {
        if (error.code === 410) {
            // Handle expired sync token by doing a full sync
            console.log("Sync token expired, performing full sync...");
            lastSyncToken = null;
            await updateCalendarEvents(auth);
        } else {
            console.error("Error updating calendar events:", error);
        }
    }
}

/**
 * Check for calendar changes using sync token
 * @param {google.auth.OAuth2} auth Authorized OAuth2 client
 */
async function watchForChanges(auth) {
    try {
        await updateCalendarEvents(auth, lastSyncToken);
    } catch (error) {
        console.error("Error in watch cycle:", error);
    }
}

/**
 * Initialize and start the application
 * @param {google.auth.OAuth2} auth Authorized OAuth2 client
 */
function startApplication(auth) {
    console.log("Calendar Weather Bot Started");
    console.log("Initial update starting...");
    
    // Perform initial update of all events
    updateCalendarEvents(auth).catch(console.error);
    
    // Set up scheduled full updates every hour
    setInterval(() => {
        console.log("\nStarting scheduled hourly update...");
        lastSyncToken = null;  // Force a full sync
        updateCalendarEvents(auth).catch(console.error);
    }, UPDATE_INTERVAL);
    
    // Set up frequent checks for calendar changes
    setInterval(() => {
        console.log("\nChecking for calendar changes...");
        watchForChanges(auth).catch(console.error);
    }, WATCH_INTERVAL);
    
    // Log startup information
    console.log(`Application started. Will perform full updates every hour.`);
    console.log(`Checking for changes every 30 minutes.`);
    console.log(`Next full update will be at: ${new Date(Date.now() + UPDATE_INTERVAL).toLocaleString()}`);
}
