const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const axios = require('axios');

// ================= პარამეტრები ================= 
const RECEIVER_URL = "https://masala.com.ge/pharmacy_receiver.php"; // შეცვალეთ თქვენი მიმღებით
const SECRET_TOKEN = "MY_SUPER_SECRET_12345";
const BASE_URL = "https://www.autowini.com";
const START_PAGE = 1;
const MAX_PAGES = 100; 

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function sendBatch(dataArray) {
    if (dataArray.length === 0) return;
    try {
        const payload = new URLSearchParams();
        payload.append('token', SECRET_TOKEN);
        payload.append('data', JSON.stringify(dataArray));
        
        console.log(`📡 აგზავნის ${dataArray.length} მანქანის სრულ მონაცემს...`);
        // const response = await axios.post(RECEIVER_URL, payload);
        // console.log(`✅ პასუხი:`, response.data);
        
        dataArray.length = 0; 
    } catch (error) {
        console.error(`❌ გაგზავნის შეცდომა:`, error.message);
    }
}

async function scrapeCarDetail(page, url) {
    console.log(`   🔍 შედის დეტალებზე: ${url}`);
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        return await page.evaluate(() => {
            const getVal = (selector, context = document) => {
                const el = context.querySelector(selector);
                return el ? el.innerText.trim() : null;
            };

            // 1. ფოტოების ამოღება
            const photos = Array.from(document.querySelectorAll('.subLeft ul li a[data-original-url]'))
                .map(a => a.getAttribute('data-original-url'));

            // 2. ძირითადი ინფორმაცია (Basic Information)
            const basicInfo = {};
            document.querySelectorAll('.infoTbl li dl').forEach(dl => {
                const key = dl.querySelector('dt')?.innerText.replace(':', '').trim();
                const val = dl.querySelector('dd')?.innerText.trim();
                if (key) basicInfo[key] = val;
            });

            // 3. გამორჩეული ინფორმაცია (Featured Info)
            const featuredInfo = {};
            document.querySelectorAll('.featureInfo .special li').forEach(li => {
                const key = li.querySelector('span')?.innerText.trim();
                const val = li.querySelector('b')?.innerText.trim();
                if (key) featuredInfo[key] = val;
            });

            // 4. ოფციები (Options)
            const options = {};
            document.querySelectorAll('.optionInfo ul li').forEach(li => {
                const category = li.querySelector('h3')?.innerText.trim() || "Other";
                const list = Array.from(li.querySelectorAll('.list span')).map(s => s.innerText.trim());
                options[category] = list;
            });

            // 5. ავტომობილის მდგომარეობა (Condition Report - VCR)
            const conditionReport = { engine: '', body: {}, transmission: '' };
            document.querySelectorAll('.statusArea, .conReport .statusArea').forEach(area => {
                area.querySelectorAll('li').forEach(li => {
                    const k = li.querySelector('dt')?.innerText.trim();
                    const v = li.querySelector('dd')?.innerText.trim();
                    if (k) conditionReport.body[k] = v;
                });
            });

            // 6. ფასი და სათაური
            const title = document.querySelector('h1')?.innerText.trim();
            const price = document.querySelector('.price .itemPrice .total strong')?.innerText.trim();

            return {
                title,
                price,
                photos,
                basicInfo,
                featuredInfo,
                options,
                conditionReport,
                url: window.location.href
            };
        });
    } catch (e) {
        console.error(`      ⚠️ შეცდომა დეტალების წაკითხვისას: ${e.message}`);
        return null;
    }
}

(async () => {
    const browser = await puppeteer.launch({
        headless: false, // შეგიძლიათ შეცვალოთ "new"-ზე
        args: ['--no-sandbox', '--window-size=1920,1080']
    });

    const mainPage = await browser.newPage();
    const detailPage = await browser.newPage(); // ცალკე გვერდი დეტალებისთვის სწრაფი მუშაობისთვის
    await mainPage.setViewport({ width: 1920, height: 1080 });

    let batch = [];

    try {
        for (let p = START_PAGE; p <= MAX_PAGES; p++) {
            const pageUrl = `https://www.autowini.com/search/items?itemType=cars&condition=C020&pageOffset=${p}`;
            console.log(`\n🚀 ვამუშავებთ გვერდს: ${p}`);
            
            await mainPage.goto(pageUrl, { waitUntil: 'networkidle2' });

            // ჩამოსქროლვა ბოლომდე, რომ ყველა "lazy load" ელემენტი გამოჩნდეს
            await mainPage.evaluate(async () => {
                await new Promise(resolve => {
                    let totalHeight = 0;
                    let distance = 500;
                    let timer = setInterval(() => {
                        let scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            // მანქანების ლინკების ამოღება (ყველა მანქანის ბარათიდან)
            const carLinks = await mainPage.evaluate(() => {
                // ვეძებთ a თეგებს, რომლებსაც აქვთ /items/ თავის href-ში
                return Array.from(document.querySelectorAll('a[href*="/items/Used-"]'))
                            .map(a => a.href)
                            .filter((value, index, self) => self.indexOf(value) === index); // დუბლიკატების მოცილება
            });

            console.log(`✅ გვერდზე ნაპოვნია ${carLinks.length} ავტომობილი.`);

            if (carLinks.length === 0) {
                console.log("🏁 პროდუქტები აღარ არის. სკრაპინგი დასრულდა.");
                break;
            }

            // სათითაოდ შევდივართ თითოეულ ლინკზე
            for (const link of carLinks) {
                const details = await scrapeCarDetail(detailPage, link);
                if (details) {
                    batch.push(details);
                    // RAM-ის დასაზოგად და მონაცემების დასაკარგად, ყოველ 5 მანქანაზე ვაგზავნით ბაზაში
                    if (batch.length >= 5) {
                        await sendBatch(batch);
                    }
                }
                await sleep(1000); // მცირე პაუზა ბლოკის თავიდან ასაცილებლად
            }
            
            // ნარჩენების გაგზავნა გვერდის ბოლოს
            await sendBatch(batch);
        }

    } catch (err) {
        console.error("🛑 კრიტიკული შეცდომა ციკლში:", err);
    } finally {
        await browser.close();
        console.log("🏁 პროცესი დასრულებულია.");
    }
})();
