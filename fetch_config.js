const http = require('http');

http.get('http://localhost:3000/api/v1/telares?view=map', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            const t69 = json.data.find(t => t.telarKey === '0069' || t.telnom === '69');
            console.log(JSON.stringify(t69, null, 2));
        } catch (e) {
            console.error('Error parsing JSON:', e.message);
            console.log('Raw data:', data.substring(0, 200));
        }
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});
