require('dotenv').config();
const cron = require('node-cron');

//Hosts Array
const HOSTS = [
    'http://localhost:8000',
];

const SECRET = process.env.SENTINEL_SECRET;

console.log(`Sentinel Active. Monitoring ${HOSTS.length} hosts...`);



// 0 * * * *for houre 
// */30 * * * * * for 30 seconds
// Schedule: Runs at 00:01 every day
cron.schedule('0 * * * *', async () => {
    console.log(`Heartbeat Start: ${new Date().toLocaleString()}`);

    // 2. Map the hosts into a list of fetch promises
    const pulseRequests = HOSTS.map(host => 
        fetch(`${host}/sentinel/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sentinel-token': SECRET
            },
            body: JSON.stringify({ source: "Sentinel-V1" })
        })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.msg || `HTTP ${res.status}`);
            return { host, msg: data.msg };
        })
    );

    // 3. Execute all requests in parallel
    const results = await Promise.allSettled(pulseRequests);

    // 4. Log the report for each host
    results.forEach((result, index) => {
        const host = HOSTS[index];
        if (result.status === 'fulfilled') {
            console.log(`✅ [${host}]: Pulse Successful - ${result.value.msg}`);
        } else {
            console.error(`❌ [${host}]: Pulse Failed - ${result.reason.message}`);
        }
        
        
    });
    console.log("============================");
});