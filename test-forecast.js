require('dotenv').config();
const axios = require('axios');

async function testForecast() {
    try {
        const apiKey = process.env.WEATHERAPI_KEY;
        const city = 'Seoul';
        const url = `http://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${city}&days=3`;

        console.log('API Key:', apiKey ? 'Present' : 'Missing');
        console.log('Requesting URL:', url.replace(apiKey, 'API_KEY_HIDDEN'));
        
        const response = await axios.get(url);
        
        console.log('\nAPI Response Structure:');
        console.log('Location:', response.data.location);
        console.log('\nForecast days available:', response.data.forecast?.forecastday?.length);
        
        if (response.data.forecast?.forecastday) {
            response.data.forecast.forecastday.forEach(day => {
                console.log(`\n=== ${day.date} ===`);
                if (day.hour) {
                    day.hour.forEach(hour => {
                        const time = new Date(hour.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                        console.log(`${time}: ${hour.condition.text}, ${hour.temp_c}°C`);
                    });
                } else {
                    console.log('No hourly data available');
                }
            });
        } else {
            console.log('No forecast data in response');
            console.log('Full response:', JSON.stringify(response.data, null, 2));
        }
    } catch (error) {
        console.error('Error details:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

testForecast(); 