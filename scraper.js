const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const axios = require('axios');

// ================= პარამეტრები ================= 
const RECEIVER_URL = "https://masala.com.ge/pharmacy_receiver.php";
const SECRET_TOKEN = "MY_SUPER_SECRET_12345";
const START_PAGE = 1;
const MAX_PAGES = 100;

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function sendBatch(dataArray) {
    if (dataArray.length === 0) return;
    try {
        console.log(`📡 ბაზაში იგზავნება ${dataArray.length} მანქანა...`);
        // აქ ჩასვით თქვენი რეალური axios.post თუ გსურთ გაგზავნა
        dataArray.length = 0;
    } catch (error) {
        console.error(`❌ გაგზავნის შეცდომა:`, error.message);
    }
}

async function scrapeCarDetail(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        const data = await page.evaluate(() => {
            const getT = (s) => document.querySelector(s)?.innerText.trim() || "";
            
            // 1. ფოტოების ამოღება
            const photos = Array.from(document.querySelectorAll('.subLeft ul li a[data-original-url]'))
                .map(a => a.getAttribute('data-original-url'))
                .filter(u => u && u.startsWith('http'));

            // 2. ძირითადი ინფო (Basic Info)
            const basic = {};
            document.querySelectorAll('.infoTbl li dl').forEach(dl => {
                const k = dl.querySelector('dt')?.innerText.trim();
                const v = dl.querySelector('dd')?.innerText.trim();
                if (k) basic[k] = v;
            });

            // 3. ოფციები (Options)
            const opts = {};
            document.querySelectorAll('.optionInfo ul li').forEach(li => {
                const cat = li.querySelector('h2, h3')?.innerText.trim() || "Options";
                opts[cat] = Array.from(li.querySelectorAll('.list span')).map(s => s.innerText.trim());
            });

            return {
                title: getT('h1'),
                price: getT('.price .total strong'),
                specs: basic,
                options: opts,
                images: photos
            };
        });

        data.url = url;
        console.log(`   ✅ ამოღებულია: ${data.title}`);
        return data;
    } catch (e) {
        console.error(`   ⚠️ შეცდომა დეტალებზე: ${url}`);
        return null;
    }
}

(async () => {
    console.log("🚀 სკრაპერი ჩაირთო გარანტირებულ Headless რეჟიმში...");
    
    const browser = await puppeteer.launch({
        // headless: true - ყველაზე მნიშვნელოვანი პარამეტრი სერვერისთვის
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    try {
        const mainPage = await browser.newPage();
        const detailPage = await browser.newPage();
        await mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

        let tempStorage = [];

        for (let p = START_PAGE; p <= MAX_PAGES; p++) {
            const listUrl = `https://www.autowini.com/search/items?itemType=cars&condition=C020&pageOffset=${p}`;
            console.log(`\n📄 გვერდი: ${p}`);

            await mainPage.goto(listUrl, { waitUntil: 'networkidle2' });

            // ნელი სქროლინგი პროდუქტებისთვის
            await mainPage.evaluate(async () => {
                await new Promise(r => {
                    let h = 0;
                    let t = setInterval(() => {
                        window.scrollBy(0, 500);
                        h += 500;
                        if (h >= document.body.scrollHeight) { clearInterval(t); r(); }
                    }, 200);
                });
            });

            const links = await mainPage.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href*="/items/Used-"]'))
                    .map(a => a.href)
                    .filter((v, i, s) => s.indexOf(v) === i);
            });

            console.log(`🔗 ნაპოვნია ${links.length} ლინკი.`);
            if (links.length === 0) break;

            for (const link of links) {
                const car = await scrapeCarDetail(detailPage, link);
                if (car) {
                    tempStorage.push(car);
                    if (tempStorage.length >= 5) await sendBatch(tempStorage);
                }
                await sleep(2000); 
            }
        }
    } catch (err) {
        console.error("🛑 კრიტიკული შეცდომა:", err.message);
    } finally {
        await browser.close();
        console.log("🏁 პროცესი დასრულდა.");
    }
})();
