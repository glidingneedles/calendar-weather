# Calendar Weather Bot

Automatically updates Google Calendar events with current weather information in Seoul.

## Features

- Updates calendar events with current weather conditions and temperature
- Checks for calendar changes every 5 minutes
- Performs full update every 24 hours
- Uses WeatherAPI.com for weather data
- Runs as a background service using PM2

## Prerequisites

- Node.js
- npm
- PM2 (installed globally)
- Google Calendar API credentials
- WeatherAPI.com API key

## Setup

1. Clone the repository:
```bash
git clone https://github.com/glidingneedles/calendar-weather.git
cd calendar-weather
```

2. Install dependencies:
```bash
npm install
```

3. Set up credentials:
   - Create a project in Google Cloud Console
   - Enable Google Calendar API
   - Download OAuth 2.0 Client ID credentials and save as `credentials.json`
   - Create an account at WeatherAPI.com and get API key

4. Create `.env` file:
```bash
WEATHERAPI_KEY=your_api_key_here
```

5. Install PM2 globally:
```bash
npm install -g pm2
```

6. Start the application:
```bash
pm2 start ecosystem.config.js
```

## Usage

The bot will:
- Add current weather information to your calendar event titles
- Update automatically when you add or modify events
- Refresh weather information every 24 hours

Example event title:
```
Meeting with Team (partly cloudy, 22°C)
```

## PM2 Commands

- Start: `pm2 start ecosystem.config.js`
- Stop: `pm2 stop calendar-weather`
- Restart: `pm2 restart calendar-weather`
- View logs: `pm2 logs calendar-weather`
- Monitor: `pm2 monit`

## License

ISC

## Author

[glidingneedles](https://github.com/glidingneedles) 