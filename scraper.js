const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const axios = require('axios');

// ================= პარამეტრები ================= 
const RECEIVER_URL = "https://masala.com.ge/pharmacy_receiver.php";
const SECRET_TOKEN = "MY_SUPER_SECRET_12345";
const BASE_URL = "https://www.autowini.com";
const START_PAGE = 1;
const MAX_PAGES = 50; 

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function sendBatch(dataArray) {
    if (dataArray.length === 0) return;
    try {
        const payload = new URLSearchParams();
        payload.append('token', SECRET_TOKEN);
        payload.append('data', JSON.stringify(dataArray));
        
        console.log(`📡 იგზავნება ${dataArray.length} მანქანის სრული მონაცემი...`);
        // const response = await axios.post(RECEIVER_URL, payload); 
        dataArray.length = 0; 
    } catch (error) {
        console.error(`❌ გაგზავნის შეცდომა:`, error.message);
    }
}

async function scrapeCarDetail(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        const data = await page.evaluate(() => {
            // ფუნქცია ტექსტის ამოსაღებად
            const txt = (s) => document.querySelector(s)?.innerText.trim() || "";
            
            // 1. ფოტოების სრული კოლექცია (Thumbnail-ებიდან იღებს ორიგინალ ლინკებს)
            const photos = Array.from(document.querySelectorAll('ul li a[data-original-url]'))
                .map(a => a.getAttribute('data-original-url'))
                .filter(url => url && url.includes('http'));

            // 2. Basic Information (Item No, Year, Fuel, Transmission, etc.)
            const specs = {};
            document.querySelectorAll('.infoTbl li dl').forEach(dl => {
                const key = dl.querySelector('dt')?.innerText.trim();
                const val = dl.querySelector('dd')?.innerText.trim();
                if (key) specs[key] = val;
            });

            // 3. Options (Safety, Exterior, Interior)
            const options = {};
            document.querySelectorAll('.optionInfo ul li').forEach(li => {
                const cat = li.querySelector('h2, h3')?.innerText.trim() || "General";
                const features = Array.from(li.querySelectorAll('.list span')).map(s => s.innerText.trim());
                options[cat] = features;
            });

            // 4. Vehicle Condition Report (VCR)
            const condition = {};
            document.querySelectorAll('.statusArea').forEach(area => {
                area.querySelectorAll('li').forEach(li => {
                    const k = li.querySelector('dt')?.innerText.trim();
                    const v = li.querySelector('dd')?.innerText.trim();
                    if (k) condition[k] = v;
                });
            });

            return {
                title: txt('h1'),
                price: txt('.price .total strong'),
                details: specs,
                options: options,
                conditionReport: condition,
                images: photos
            };
        });
        
        data.url = url;
        console.log(`   ✅ მონაცემები ამოღებულია: ${data.title}`);
        return data;

    } catch (e) {
        console.error(`      ⚠️ შეცდომა დეტალებზე: ${url} | ${e.message}`);
        return null;
    }
}

(async () => {
    console.log("🚀 სკრაპერი ჩაირთო HEADLESS რეჟიმში...");
    
    const browser = await puppeteer.launch({
        headless: "new", // ახალი headless რეჟიმი CI გარემოსთვის
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1920,1080'
        ]
    });

    try {
        const mainPage = await browser.newPage();
        const detailPage = await browser.newPage();
        
        // თაღლითობის საწინააღმდეგო სისტემების გვერდის ავლით
        await mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

        let allScrapedData = [];

        for (let p = START_PAGE; p <= MAX_PAGES; p++) {
            const listUrl = `https://www.autowini.com/search/items?itemType=cars&condition=C020&pageOffset=${p}`;
            console.log(`\n📄 მუშავდება გვერდი: ${p}`);

            await mainPage.goto(listUrl, { waitUntil: 'networkidle2' });

            // ნელი სქროლინგი პროდუქტების ჩასატვირთად
            await mainPage.evaluate(async () => {
                await new Promise(resolve => {
                    let totalHeight = 0;
                    let distance = 400;
                    let timer = setInterval(() => {
                        let scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 150);
                });
            });

            // ლინკების ამოკრება
            const links = await mainPage.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href*="/items/Used-"]'))
                    .map(a => a.href)
                    .filter((v, i, s) => s.indexOf(v) === i);
            });

            console.log(`🔗 ნაპოვნია ${links.length} მანქანა.`);

            if (links.length === 0) break;

            for (const link of links) {
                const result = await scrapeCarDetail(detailPage, link);
                if (result) {
                    allScrapedData.push(result);
                    // ვაგზავნით ყოველ 5 მანქანას RAM-ის დასაზოგად
                    if (allScrapedData.length >= 5) {
                        await sendBatch(allScrapedData);
                    }
                }
                await sleep(2000); // ეთიკური პაუზა
            }
        }

    } catch (criticalErr) {
        console.error("🛑 კრიტიკული შეცდომა:", criticalErr);
    } finally {
        await browser.close();
        console.log("🏁 პროცესი დასრულდა.");
    }
})();
