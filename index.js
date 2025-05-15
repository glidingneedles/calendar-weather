// Required Node.js modules
const fs = require("fs");                    // File system module for reading/writing files locally
const readline = require("readline");         // Module for reading user input from terminal
const { google } = require("googleapis");     // Google APIs client library for calendar access
const axios = require("axios");              // HTTP client for making API requests to WeatherAPI
require("dotenv").config();                  // Load environment variables from .env file (contains API keys)

// Configuration constants
const SCOPES = ["https://www.googleapis.com/auth/calendar"];  // Google Calendar API permission scope
const TOKEN_PATH = "token.json";             // Path to store OAuth2 token after authentication
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // Full update interval: 24 hours in milliseconds
const WATCH_INTERVAL = 5 * 60 * 1000;        // Change check interval: 5 minutes in milliseconds

// Global variable for tracking calendar changes
let lastSyncToken = null;                    // Stores sync token to efficiently fetch only changed events

// Initial application setup
// Read the credentials file and start the authorization process
fs.readFile("credentials.json", (err, content) => {
    if (err) return console.log("Error loading client secret file:", err);
    // Parse credentials and start authorization
    authorize(JSON.parse(content), startApplication);
});

/**
 * Create and authorize OAuth2 client
 * @param {Object} credentials The authorization client credentials
 * @param {function} callback The callback to call with the authorized client
 */
function authorize(credentials, callback) {
    // Extract client credentials from the downloaded Google Cloud credentials
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    // Create new OAuth2 client instance
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]
    );

    // Check if we have previously stored a token
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getAccessToken(oAuth2Client, callback);  // If no token, get new one
        oAuth2Client.setCredentials(JSON.parse(token));         // Set existing token
        callback(oAuth2Client);                                 // Continue with authorized client
    });
}

/**
 * Get and store new token after prompting for user authorization
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for
 * @param {function} callback The callback for the authorized client
 */
function getAccessToken(oAuth2Client, callback) {
    // Generate URL for user to authorize the application
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",              // We want offline access (refresh token)
        scope: SCOPES,                       // Request calendar access permissions
    });
    console.log("Authorize this app by visiting this url:", authUrl);
    
    // Create interface to read user input from terminal
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    // Prompt user to enter the authorization code
    rl.question("Enter the code from that page here: ", (code) => {
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error("Error retrieving access token", err);
            oAuth2Client.setCredentials(token);           // Set the token
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));  // Save token for future use
            rl.close();
            callback(oAuth2Client);
        });
    });
}

/**
 * Fetch current weather information from WeatherAPI.com
 * @returns {Promise<string>} Weather description in format "(condition, temperature°C)"
 */
async function getWeatherEmoji() {
    const apiKey = process.env.WEATHERAPI_KEY;
    const city = "Seoul";

    // Make API request to WeatherAPI.com
    const url = `http://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${city}&aqi=no`;
    const res = await axios.get(url);
    const condition = res.data.current.condition.text.toLowerCase();
    const tempC = res.data.current.temp_c;

    // Format weather description
    let description = `(${condition}, ${Math.round(tempC)}°C)`;
    return description;
}

/**
 * Update calendar events with current weather information
 * @param {google.auth.OAuth2} auth Authorized OAuth2 client
 * @param {string} syncToken Optional token for efficient updates
 */
async function updateCalendarEvents(auth, syncToken = null) {
    const calendar = google.calendar({ version: "v3", auth });

    try {
        // Parameters for fetching calendar events
        const listParams = {
            calendarId: "primary",           // Use primary calendar
            maxResults: 40,                  // Fetch up to 40 events
            singleEvents: true,              // Expand recurring events
            orderBy: "startTime",            // Sort by start time
            timeMin: new Date().toISOString(), // Only future events
        };

        // If we have a sync token, use it to get only changed events
        if (syncToken) {
            listParams.syncToken = syncToken;
        }

        // Fetch events from Google Calendar
        const res = await calendar.events.list(listParams);
        lastSyncToken = res.data.nextSyncToken;  // Save token for next sync

        const events = res.data.items;

        if (!events || events.length === 0) {
            console.log("No events to update.");
            return;
        }

        console.log(`Updating ${events.length} events with current weather...`);
        
        // Process each event
        for (const event of events) {
            const start = event.start.dateTime || event.start.date;
            const weatherDesc = await getWeatherEmoji();
            
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
    
    // Set up scheduled full updates every 24 hours
    setInterval(() => {
        console.log("\nStarting scheduled 24-hour update...");
        lastSyncToken = null;  // Force a full sync
        updateCalendarEvents(auth).catch(console.error);
    }, UPDATE_INTERVAL);
    
    // Set up frequent checks for calendar changes
    setInterval(() => {
        console.log("\nChecking for calendar changes...");
        watchForChanges(auth).catch(console.error);
    }, WATCH_INTERVAL);
    
    // Log startup information
    console.log(`Application started. Will perform full updates every 24 hours.`);
    console.log(`Checking for changes every 5 minutes.`);
    console.log(`Next full update will be at: ${new Date(Date.now() + UPDATE_INTERVAL).toLocaleString()}`);
}
