const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const axios = require('axios');

const START_PAGE = 1;
const MAX_PAGES = 50;

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function scrapeCarDetail(page, url) {
    try {
        console.log(`   🔍 ვამუშავებთ: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        const data = await page.evaluate(() => {
            const getT = (s) => document.querySelector(s)?.innerText.trim() || "";
            
            const specs = {};
            document.querySelectorAll('.infoTbl li dl').forEach(dl => {
                const k = dl.querySelector('dt')?.innerText.trim().replace(':', '');
                const v = dl.querySelector('dd')?.innerText.trim();
                if (k) specs[k] = v;
            });

            const photos = Array.from(document.querySelectorAll('.subLeft ul li a[data-original-url]'))
                .map(a => a.getAttribute('data-original-url'))
                .filter(u => u && u.startsWith('http'));

            const options = {};
            document.querySelectorAll('.optionInfo ul li').forEach(li => {
                const cat = li.querySelector('h2, h3')?.innerText.trim() || "Options";
                options[cat] = Array.from(li.querySelectorAll('.list span')).map(s => s.innerText.trim());
            });

            return {
                title: getT('h1'),
                price: getT('.price .total strong'),
                specs: specs,
                options: options,
                images: photos
            };
        });

        return { ...data, url };
    } catch (e) {
        console.error(`      ⚠️ შეცდომა: ${url}`);
        return null;
    }
}

(async () => {
    console.log("🚀 სკრაპერი ჩაირთო CI/SERVER რეჟიმში...");
    
    const browser = await puppeteer.launch({
        headless: "new", // ახალი Headless რეჟიმი
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process'
        ]
    });

    try {
        const mainPage = await browser.newPage();
        const detailPage = await browser.newPage();
        await mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

        for (let p = START_PAGE; p <= MAX_PAGES; p++) {
            const listUrl = `https://www.autowini.com/search/items?itemType=cars&condition=C020&pageOffset=${p}`;
            console.log(`\n📄 გვერდი: ${p}`);
            await mainPage.goto(listUrl, { waitUntil: 'networkidle2' });

            const links = await mainPage.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href*="/items/Used-"]'))
                    .map(a => a.href)
                    .filter((v, i, s) => s.indexOf(v) === i);
            });

            if (links.length === 0) break;

            for (const link of links) {
                const result = await scrapeCarDetail(detailPage, link);
                if (result) {
                    console.log(`      ✅ წარმატება: ${result.title}`);
                    // აქ შეგიძლიათ დაამატოთ axios.post მონაცემების გასაგზავნად
                }
                await sleep(2000); 
            }
        }
    } catch (err) {
        console.error("🛑 კრიტიკული შეცდომა:", err.message);
    } finally {
        await browser.close();
        console.log("🏁 დასრულდა.");
    }
})();
