const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const puppeteer   = require('puppeteer');

// ============================================================
//  CONFIG
// ============================================================
const BOT_TOKEN    ="8692459169:AAHmpdQ3pcdmi0lPJzmHiw7N-H7l1QzP8kI";
const OWNER_ID     = 8321379592;
const OWNER_PASS   = "2004";
const ADMIN_HANDLE = "@Sivakutty1";
const REG_LINK     = "https://bdgwinuu.com/#/register?invitationCode=7442815992780";
const WIN_STICKER  = "CAACAgUAAxkBAAFHUGNp4JX1-ohP4uBEWpfNptaz-HmwVgAC4hgAAhboKVbObuGuTcMs2zsE";
const LOSS_STICKER = "CAACAgUAAxkBAAFHUGVp4JX-BE2TRkhIKTwcjkwW-gzdPAACthoAAoG8YVYiydObSa0O8zsE";

const BET_URL     = "https://api.ar-lottery01.com/api/Lottery/WinGoBet";
const LOGIN_URL   = "https://api.bdg88zf.com/api/webapi/Login";
const CAPTCHA_URL = "https://api.bdg88zf.com/api/webapi/GetCaptcha";
const DRAW_URL    = "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";

// Martingale multipliers — user can customize base bet
const MULT = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683]; // Standard 3x Martingale multipliers

// ============================================================
//  RENDER KEEP-ALIVE
// ============================================================
const http = require('http');
const PORT = process.env.PORT || 5000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('SIVA BOT OK');
}).listen(PORT, () => console.log(`✅ Keep-alive server on port ${PORT}`));

const RENDER_URL = process.env.RENDER_URL || "";
if (RENDER_URL) {
    setInterval(() => {
        axios.get(RENDER_URL).catch(() => {});
        console.log("[PING] Keep-alive ping sent");
    }, 14 * 60 * 1000);
}

// ============================================================
//  STORAGE
// ============================================================
let ownerLoggedIn  = false;
let adminPasswords = {};
let adminLoggedIn  = {};
let usersAccess    = {};
let keyStore       = {};
let stats          = {};
let running        = {};
let sentPeriods    = {};
let ownerState     = null;
let adminState   = {};
let userAction   = {}; 
let userCreds      = {};
let autobetCfg     = {};
let autobetState   = {};
let profitTrack    = {};
let GLOBAL_TOKEN   = "";
let userTokens = {}; 

// ============================================================
//  LOGGING HELPER
// ============================================================
async function logBoth(chatId, msg, isError = false) {
    if (isError) console.error(msg);
    else console.log(msg);
    if (chatId) {
        if (bot) {
            try {
                await bot.sendMessage(chatId, msg);
            } catch (e) {
                // Ignore message sending errors to prevent loops
            }
        }
    }
}

// ============================================================
//  HELPERS
// ============================================================
async function fetchList() {
    try {
        const response = await axios.get(DRAW_URL, {
            headers: {
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://bdgwin901.com",
                "Referer": "https://bdgwin901.com/",
                "Ar-Origin": "https://bdgwin901.com",
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
            },
            timeout: 10000
        });
        if (response.data && response.data.data && response.data.data.list) {
            return response.data.data.list;
        }
        return [];
    } catch (error) {
        console.error("[FETCH LIST ERROR]", error.message);
        return null;
    }
}

async function parseBalanceResponse(r) {
    if (r.data && r.data.code === 0 && r.data.data && typeof r.data.data.balance !== 'undefined') {
        return { success: true, balance: r.data.data.balance };
    }
    return {
        success: false,
        message: r.data && r.data.msg ? r.data.msg : "Token expired or invalid"
    };
}

async function getLiveBalance(userId, chatId = null) {
    let token = getToken(userId);
    if (!token && chatId) {
        const ok = await autoLogin(userId, chatId, true);
        if (ok) token = getToken(userId);
    }
    if (!token) return { success: false, message: "No token" };

    const url = "https://api.bdg88zf.com/api/webapi/GetBalance";
    const headers = {
        "Authorization": "Bearer " + token,
        "Ar-Origin": "https://bdgwin901.com",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
    };

    try {
        const r = await axios.get(url, { headers, timeout: 5000 });
        return await parseBalanceResponse(r);
    } catch (e) {
        if (e.response && e.response.status === 405) {
            try {
                const r2 = await axios.post(url, {}, { headers, timeout: 5000 });
                return await parseBalanceResponse(r2);
            } catch (e2) {
                const errMsg = e2.response?.data?.msg || e2.message || "API Error";
                return { success: false, message: errMsg };
            }
        }
        const errMsg = e.response?.data?.msg || e.message || "API Error";
        return { success: false, message: errMsg };
    }
}

function initUser(id) {
    if (!stats[id])        stats[id]        = { total:0,win:0,loss:0,lossStreak:0,winStreak:0,maxWinStreak:0,maxLossStreak:0 };
    if (!userStates[id])   initState(id);
    if (!sentPeriods[id])  sentPeriods[id]  = new Set();
    if (!autobetCfg[id])   autobetCfg[id]   = { 
        watch:false, 
        watchLoss:2, 
        baseBet:1, 
        maxLvl:5, 
        enabled:false, 
        customBets:[1,3,9,27,81],
        targetProfit: 1000,
        restartDelay: 1
    };
    if (!autobetState[id]) autobetState[id] = { 
        level:1, 
        consecutiveLoss:0, 
        inMart:false,
        isWaiting: false,
        nextStartTime: null
    };
    if (!profitTrack[id])  profitTrack[id]  = { totalBets:0, wins:0, losses:0, pnl:0, winStreak:0, lossStreak:0, maxW:0, maxL:0, totalBetAmount: 0 };
}

function hasAccess(id) {
    if (Number(id) === Number(OWNER_ID)) return true;
    if (running[id] === true) return true;
    const expiry = usersAccess[id];
    return !!(expiry && Date.now() < expiry);
}
function daysLeft(id) {
    if (Number(id) === Number(OWNER_ID)) return "∞";
    if (running[id] === true) return "RUN";
    const expiry = usersAccess[id];
    if (!expiry) return "0";
    const left = (expiry - Date.now()) / 86400000;
    return left > 0 ? left.toFixed(1) : "0";
}
function isAdmin(id)    { return adminPasswords[id] !== undefined; }
function isAdminIn(id)  { return adminLoggedIn[id] === true; }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }
function getToken(id)   { return userTokens[id] || GLOBAL_TOKEN || ""; }

function generateKey(days, by) {
    const k = "EARN WITH ME-"+crypto.randomBytes(3).toString('hex').toUpperCase()+"-"+crypto.randomBytes(2).toString('hex').toUpperCase();
    keyStore[k] = { days, used:false, usedBy:null, by:by||OWNER_ID };
    return k;
}
function activateKey(userId, code) {
    const k = code.toUpperCase().trim();
    if (!keyStore[k])     return { ok:false, msg:"❌ Invalid key!" };
    if (keyStore[k].used) return { ok:false, msg:"❌ Key already used!" };

    const days = Number(keyStore[k].days) || 1;
    const currentExpiry = usersAccess[userId];
    const base = (currentExpiry && currentExpiry > Date.now()) ? currentExpiry : Date.now();
    const newExpiry = base + days * 86400000;

    keyStore[k].used=true;
    keyStore[k].usedBy=userId;
    usersAccess[userId] = newExpiry;
    return { ok:true, days, expiry:new Date(newExpiry).toLocaleString() };
}
function activeUsersList() {
    const now=Date.now();
    const ids = new Set(Object.keys(usersAccess));
    Object.keys(running).forEach(id => { if (running[id]) ids.add(id); });
    const list = [...ids].filter(id => Number(id) === Number(OWNER_ID) || running[id] || Number(usersAccess[id]) > now);
    if (!list.length) return "No active users.";
    return list.map(id => {
        if (Number(id) === Number(OWNER_ID)) return "🟢 " + id + " | ♾️ Unlimited";
        if (running[id]) return "🟢 " + id + " | ⚡ Running";
        const expiry = Number(usersAccess[id]) || 0;
        return "🟢 " + id + " | " + ((expiry - now) / 86400000).toFixed(1) + "d";
    }).join("\n");
}
function adminList() {
    const ids=Object.keys(adminPasswords);
    return ids.length ? ids.map(id=>"👤 "+id+" | "+(adminLoggedIn[id]?"🟢 Online":"🔴 Offline")).join("\n") : "No admins.";
}
function allKeysList() {
    const keys=Object.entries(keyStore);
    return keys.length ? keys.map(([k,v])=>k+" → "+(v.used?"✅ Used":"🟢 "+v.days+"d")).join("\n") : "No keys.";
}

function getOrCreateDevice(userId) {
    if (!userCreds[userId]) userCreds[userId] = {};
    if (!userCreds[userId].deviceId) {
        userCreds[userId].deviceId = crypto.randomBytes(16).toString('hex');
    }
    return userCreds[userId].deviceId;
}

function makeLoginSign(params) {
    const p = {...params};
    delete p.signature; delete p.timestamp; delete p.track;
    const keys = Object.keys(p).filter(k => {
        const v = p[k];
        if (v === null || v === undefined || v === "") return false;
        if (typeof v === 'object') return false;
        return true;
    }).sort();
    const sorted = {};
    keys.forEach(k => { sorted[k] = p[k]; });
    const str = JSON.stringify(sorted);
    const sig = crypto.createHash('md5').update(str).digest('hex').toUpperCase().slice(0,32);
    return sig;
}

function makeBetSign(params) {
    const p = {...params};
    delete p.signature; delete p.timestamp;
    const keys = Object.keys(p).filter(k=>p[k]!==null&&p[k]!=="").sort();
    const sorted = {};
    keys.forEach(k=>{ sorted[k]=p[k]===0?0:p[k]; });
    return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex').toUpperCase().slice(0,32);
}

async function fetchCaptcha() {
    try {
        const r = await axios.get(CAPTCHA_URL, {
            headers: {
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://bdgwin8.vip",
                "Referer": "https://bdgwin8.vip",
                "Ar-Origin": "https://bdgwin901.com",
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
            },
            timeout: 10000
        });
        if (r.data?.code===0 && r.data?.data?.captchaId) {
            return r.data.data.captchaId;
        }
        return "";
    } catch(e) {
        console.error("[CAPTCHA ERR]", e.message);
        return "";
    }
}

async function autoLogin(userId, chatId, silent = false) {
    const creds = userCreds[userId] || {};
    const { phone, pass } = creds;
    if (!phone || !pass) {
        await logBoth(chatId, `[AUTO LOGIN] User ${userId} has no phone or password set.`);
        return false;
    }
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(90000); 
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        let capturedToken = null;
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.url().includes('GetBalance') && req.headers()['authorization']) {
                capturedToken = req.headers()['authorization'].replace(/^Bearer\s+/i, "");
            }
            req.continue();
        });
        await page.goto('https://bdgwin901.com/#/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForSelector('input', { timeout: 30000 });
        const inputs = await page.$$('input');
        if (inputs.length < 2) throw new Error("Login inputs not found");
        await inputs[0].type(phone, { delay: 50 });
        await inputs[1].type(pass, { delay: 50 });
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const loginBtn = btns.find(b => b.innerText.includes('Log in') || b.innerText.includes('Login'));
            if (loginBtn) loginBtn.click();
            else document.querySelector('form')?.submit();
        });
        try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) {}
        await new Promise(r => setTimeout(r, 5000));
        await page.evaluate(() => {
            const closeBtn = document.querySelector('.van-icon-cross') || document.querySelector('.close-icon');
            if (closeBtn) closeBtn.click();
        });
        await new Promise(r => setTimeout(r, 1000));
        await page.evaluate(() => {
            const navItems = Array.from(document.querySelectorAll('div, span'));
            const lotteryBtn = navItems.find(el => el.innerText.trim() === 'Lottery');
            if (lotteryBtn) lotteryBtn.click();
        });
        await new Promise(r => setTimeout(r, 2000));
        if (capturedToken) {
            userTokens[userId] = capturedToken;
            if (!silent) await logBoth(chatId, "✅ Login Success! Token updated.");
            await browser.close();
            return true;
        }
        throw new Error("Token not captured");
    } catch (e) {
        if (browser) await browser.close();
        if (!silent) await logBoth(chatId, "❌ Login Failed: " + e.message);
        return false;
    }
}

async function placeBet(userId, chatId, period, val, type, betLevel) {
    let token = getToken(userId);
    if (!token) {
        const ok = await autoLogin(userId, chatId, true);
        if (ok) token = getToken(userId);
    }
    if (!token) return { ok: false, msg: "No token" };

    const cfg = autobetCfg[userId];
    const betMult = cfg.customBets[betLevel-1] || (cfg.baseBet * MULT[betLevel-1]);
    const bc = type === "SIZE" ? (val === "BIG" ? 1 : 2) : (val === "RED" ? 1 : 2);

    const maxRetries = 3;
    const retryDelayMs = 2000;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const ts = Date.now();
            const device = getOrCreateDevice(userId);
            const data = {
                amount: betMult,
                betContent: bc,
                issueNumber: period,
                lotteryId: 1,
                typeId: 1
            };
            const sig = makeBetSign(data);
            const res = await axios.post(BET_URL, data, {
                headers: {
                    "Authorization": "Bearer " + token,
                    "Signature": sig,
                    "Timestamp": ts,
                    "Device-Id": device,
                    "Ar-Origin": "https://bdgwin901.com",
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
                },
                timeout: 10000
            });

            const d = res.data;
            if (d.data && d.data.token) {
                 userTokens[userId] = d.data.token;
            }
            if (d.code === 0 || d.msg === "Succeed" || d.msgCode === 0) {
                return { ok: true, amt: betMult, bc };
            }
            if (d.code === 401 || d.code === 40100 || (d.msg && (d.msg.toLowerCase().includes("token") || d.msg.toLowerCase().includes("expired")))) {
                const loginSuccess = await autoLogin(userId, chatId, true);
                if (loginSuccess) {
                    token = getToken(userId);
                    continue;
                } else return false;
            }
            const lowerMsg = (d.msg || "").toLowerCase();
            if (lowerMsg.includes("param is invalid") || lowerMsg.includes("issue number does not exist") || lowerMsg.includes("period current settled")) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                continue; 
            }
            await send(chatId, "❌ Bet fail: " + (d.msg || JSON.stringify(d).substr(0, 60)));
            return false;
        } catch (err) {
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                continue;
            }
            await send(chatId, "❌ Network error during bet: " + err.message);
            return false;
        }
    }
    return false;
}

// ============================================================
//  STATE & PREDICTION LOGIC (Updated)
// ============================================================
let userStates = {};

function initState(userId) {
    if (!userStates[userId]) {
        userStates[userId] = {
            mode: "NORMAL",              // Always starts in Normal Mode
            pendingPrediction: true,
            forcedModeQueue: [],         // Queue for pattern predictions (RNRNRN / NRNRNR)
            historyModes: [],
            periodCounter: 0,        
            normalWinsIn20: 0,       
            recoveryWinsIn20: 0,
            lastPredictionWasLoss: false,
            consecutivePatternLoss: 0
        };
    } else {
        if (!userStates[userId].historyModes) userStates[userId].historyModes = [];
        if (!userStates[userId].forcedModeQueue) userStates[userId].forcedModeQueue = [];
        if (userStates[userId].mode === undefined) userStates[userId].mode = "NORMAL";
    }
}

function decidePrediction(list, currentLevel, userId) {
    if (!list || list.length < 2) return null;

    initState(userId);
    const state = userStates[userId];

    let effectiveMode = state.mode;
    const patternStr = state.historyModes.join("");

    // 1. Pattern Detection & Queue Assignment
    if (patternStr.endsWith("NRNR")) {
        // NRNR vantha -> RNRNRN prediction sequence queue panrom
        state.forcedModeQueue = ['R', 'N', 'R', 'N', 'R', 'N'];
    } else if (patternStr.endsWith("RNRN")) {
        // RNRN vantha -> NRNRNR prediction sequence queue panrom
        state.forcedModeQueue = ['N', 'R', 'N', 'R', 'N', 'R'];
    }

    // 2. If forced queue is active, use the next item from queue
    if (state.forcedModeQueue && state.forcedModeQueue.length > 0) {
        const nextChar = state.forcedModeQueue[0];
        effectiveMode = (nextChar === "R") ? "RECOVERY" : "NORMAL";
    } else {
        effectiveMode = state.mode;
    }

    const currentPeriod = String(list[0].issueNumber);
    const currentResult = parseInt(list[0].number || list[0].winNumber || 0);

    const nextPeriodNum = BigInt(currentPeriod) + 1n;
    const nextPeriod = nextPeriodNum.toString();
    const nextLast3Num = parseInt(nextPeriod.slice(-3));

    const answer = nextLast3Num * Math.exp(currentResult);
    const answerStr = answer.toString();
    const noDecimal = answerStr.replace('.', '');
    const first14 = noDecimal.substring(0, 14);
    const lastDigit = parseInt(first14.charAt(first14.length - 1));

    const normalPrediction = lastDigit <= 4 ? 'SMALL' : 'BIG';
    const recoveryPrediction = lastDigit <= 4 ? 'BIG' : 'SMALL';

    const prediction = (effectiveMode === "RECOVERY") ? recoveryPrediction : normalPrediction;

    const currentModeChar = effectiveMode === "NORMAL" ? "N" : "R";
    // We only log to history if it's different from last to keep it readable, 
    // but for pattern matching NRNR, we should log every period.
    state.historyModes.push(currentModeChar);
    if (state.historyModes.length > 20) {
        state.historyModes.shift();
    }

    return {
        type: "SIZE",
        val: prediction,
        conf: 85,
        pat: effectiveMode + (state.forcedModeQueue.length > 0 ? ` (Q:${state.forcedModeQueue.length})` : "")
    };
}

function updateAfterResult(userId, wasWin, actual, betPlaced) {
    initState(userId);
    const state = userStates[userId];
    
    state.lastPredictionWasLoss = !wasWin;
    state.periodCounter++;

    // Mode transition logic based on your rules:
    // - Start in Normal
    // - Loss -> Normal becomes Recovery, Recovery becomes Normal
    // - Win -> Maintain state
    if (!wasWin) {
        if (state.mode === "NORMAL") {
            state.mode = "RECOVERY";
        } else {
            state.mode = "NORMAL";
        }
    }
    // If wasWin is true, state.mode remains unchanged.

    // Handle forced queue progression
    if (state.forcedModeQueue && state.forcedModeQueue.length > 0) {
        state.forcedModeQueue.shift();
    }

    // Martingale & Autobet level update
    if (typeof autobetState !== 'undefined' && autobetState[userId]) {
        const st = autobetState[userId];
        const cfg = autobetCfg[userId];

        if (betPlaced) {
            if (wasWin) {
                st.level = 1;
                st.consecutiveLoss = 0;
            } else {
                st.consecutiveLoss++;
                st.level++;
                if (st.level > cfg.maxLvl) {
                    st.level = 1;
                    st.consecutiveLoss = 0;
                }
            }
        } else {
            if (cfg && cfg.watch) {
                if (wasWin) st.consecutiveLoss = 0;
                else st.consecutiveLoss++;
            }
        }
    }
}

function getStatus(userId) {
    initState(userId);
    const state = userStates[userId];
    return state.mode;
}

// ============================================================
//  UI & STATS HANDLERS
// ============================================================
async function handleWin(userId, chatId, actual, num, betLevel) {
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const amt = cfg.customBets[betLevel-1] || (cfg.baseBet * MULT[betLevel-1]);
    const profit = amt * 0.98;
    pt.totalBets++; pt.wins++; pt.pnl += profit; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.winStreak++; pt.lossStreak = 0;
    if(pt.winStreak > pt.maxW) pt.maxW = pt.winStreak;
    await send(chatId,
"╔══════════════════════════╗\n║  ✅ WIN! 🎉              ║\n╠══════════════════════════╣\n"+
"║ Number : "+num+"\n║ Result : "+actual+"\n║ Profit : +₹"+profit.toFixed(2)+"\n║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Streak : "+pt.winStreak+" wins\n║ Total  : "+pt.wins+"W/"+pt.losses+"L\n║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n╚══════════════════════════╝"
    );
    await sendSticker(chatId, WIN_STICKER);
}

async function handleLoss(userId, chatId, actual, num, betLevel) {
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const amt = cfg.customBets[betLevel-1] || (cfg.baseBet * MULT[betLevel-1]);
    pt.totalBets++; pt.losses++; pt.pnl -= amt; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.lossStreak++; pt.winStreak = 0;
    if(pt.lossStreak > pt.maxL) pt.maxL = pt.lossStreak;
    if(betLevel < cfg.maxLvl){
        const next = cfg.customBets[st.level-1] || (cfg.baseBet * MULT[st.level-1]);
        await send(chatId,
"╔══════════════════════════╗\n║  ❌ LOSS                 ║\n╠══════════════════════════╣\n"+
"║ Number : "+num+"\n║ Result : "+actual+"\n║ Loss   : -₹"+amt+"\n║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"╠══════════════════════════╣\n║ Next L"+st.level+" : ₹"+next+"\n╚══════════════════════════╝"
        );
    } else {
        await send(chatId,
"╔══════════════════════════╗\n║  💀 MAX LEVEL LOSS       ║\n╠══════════════════════════╣\n"+
"║ Loss   : -₹"+amt+"\n║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n╚══════════════════════════╝"
        );
    }
    await sendSticker(chatId, LOSS_STICKER);
}

// ============================================================
// PREDICT LOOP
// ============================================================
async function runPredict(userId, chatId) {
    if(!running[userId]) return;
    initUser(userId);
    const st = autobetState[userId];
    const cfg = autobetCfg[userId];

    if (st.isWaiting) {
        if (Date.now() >= st.nextStartTime) {
            st.isWaiting = false;
            profitTrack[userId].pnl = 0; 
            await send(chatId, "🔄 Timed Restart! Starting new section...");
        } else return setTimeout(()=>runPredict(userId,chatId), 30000);
    }

    const list = await fetchList();
    if(!list) return setTimeout(()=>runPredict(userId,chatId), 15000);

    const next = (BigInt(list[0].issueNumber)+1n).toString();
    if(sentPeriods[userId].has(next)) return setTimeout(()=>runPredict(userId,chatId), 2000);
    sentPeriods[userId].add(next);

    const signal = decidePrediction(list, st.level, userId);
    if(!signal) return setTimeout(()=>runPredict(userId,chatId), 5000);

    let abLine = "🤖 AutoBet: OFF";
    let canBet = false;
    if (!cfg || !cfg.enabled) {
        abLine = "🤖 AutoBet: OFF";
    } else if (cfg.watch && st.consecutiveLoss < cfg.watchLoss) {
        abLine = `👀 WATCHING: ${st.consecutiveLoss}/${cfg.watchLoss}`;
    } else {
        canBet = true;
        const curBet = cfg.customBets[st.level-1] || (cfg.baseBet*MULT[st.level-1]);
        abLine = (st.level > 1 ? "📈 MART " : "💰 BET ") + "L" + st.level + ": ₹" + curBet;
    }

    const patternName = signal.pat;
    const waitLine = (cfg && cfg.watch && st.consecutiveLoss < cfg.watchLoss) ? "\nWatch Loss: " + st.consecutiveLoss + "/" + cfg.watchLoss : "";

    await send(chatId,
"╔══════════════════════════╗\n║    👑 EARN WITH ME AI    ║\n╠══════════════════════════╣\n"+
"║ Period  : "+next.slice(-6)+"\n║ Signal  : "+(signal.val==="BIG"?"🔵 BIG":"🟠 SMALL")+"\n║ Pattern : "+patternName+"\n"+
"╠══════════════════════════╣\n║ "+abLine+"\n"+waitLine+"\n╚══════════════════════════╝",
        {reply_markup:{inline_keyboard:[[{text:"💰 CHECK NOW",url:REG_LINK}]]}}
    );

    let betPlaced = false;
    if (canBet) { 
        const result = await placeBet(userId, chatId, next, signal.val, signal.type, st.level);
        if (result && result.ok) {
            betPlaced = true;
            await send(chatId, "✅ Bet Success! ₹" + result.amt + " L" + st.level + "\n⏳ Checking result...");
        } else if (result && !result.ok) {
            await send(chatId, "❌ Bet Failed: " + (result.msg || "Unknown error"));
        }
    }
    checkResult(userId, chatId, next, signal.val, signal.type, betPlaced);
}

async function checkResult(userId, chatId, target, predicted, predType, betPlaced) {
    let tries = 0;
    const cfg = autobetCfg[userId];
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    const iv = setInterval(async () => {
        if (!running[userId]) return clearInterval(iv);
        if (++tries > 25) {
            clearInterval(iv);
            await logBoth(chatId, "⏱ Timeout — checking next period...");
            setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 3000);
            return;
        }
        const list = await fetchList(); if (!list) return;
        if (BigInt(list[0].issueNumber) < BigInt(target)) return;
        clearInterval(iv);
        const res = list.find(i => i.issueNumber === target) || list[0];
        const num = parseInt(res.number || res.winNumber || 0);
        let actual = num >= 5 ? "BIG" : "SMALL";
        const win = predicted === actual;
        const betLevel = st.level;
        updateAfterResult(userId, win, actual, betPlaced);
        const s = stats[userId];
        s.total++;
        if (win) {
            s.win++; s.winStreak++; s.lossStreak = 0;
            if (s.winStreak > s.maxWinStreak) s.maxWinStreak = s.winStreak;
        } else {
            s.loss++; s.lossStreak++; s.winStreak = 0;
            if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
        }
        if (betPlaced) {
            if (win) await handleWin(userId, chatId, actual, num, betLevel);
            else await handleLoss(userId, chatId, actual, num, betLevel);
            const targetProfit = Number(cfg.targetProfit) || 1000;
            if (pt.pnl >= targetProfit) {
                st.isWaiting = true;
                st.nextStartTime = Date.now() + (Number(cfg.restartDelay) || 1) * 60 * 1000;
                await send(chatId, "🎯 TARGET REACHED! Bot Paused.");
            }
        } else {
            if (win) {
                await send(chatId, "╔══════════════════════════╗\n║  👀 WATCH RESULT: WIN! ✅ ║\n╠══════════════════════════╣\n║ Number : "+num+"\n║ Result : "+actual+"\n║ Status : Correct Prediction\n╚══════════════════════════╝");
                await sendSticker(chatId, WIN_STICKER);
            } else {
                await send(chatId, "╔══════════════════════════╗\n║  👀 WATCH RESULT: LOSS ❌ ║\n╠══════════════════════════╣\n║ Number : "+num+"\n║ Result : "+actual+"\n║ Status : Incorrect Prediction\n╚══════════════════════════╝");
                await sendSticker(chatId, LOSS_STICKER);
            }
        }
        setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 8000);
    }, 10000);
}

function showStats(chatId,userId){
    const d=stats[userId],rate=d.total?((d.win/d.total)*100).toFixed(1):"0.0";
    const bar="🟦".repeat(d.total?Math.round(d.win/d.total*10):0)+"⬜".repeat(d.total?10-Math.round(d.win/d.total*10):10);
    send(chatId,"📊 STATS\n\nTotal: "+d.total+"\nWins: "+d.win+"\nLosses: "+d.loss+"\nAcc: "+rate+"%\n"+bar+"\n\nBest Win: "+d.maxWinStreak+" streak\nWorst Loss: "+d.maxLossStreak+" streak");
}
async function profitReport(chatId,userId){
    initUser(userId);
    const pt=profitTrack[userId],cfg=autobetCfg[userId];
    const rate=pt.totalBets?((pt.wins/pt.totalBets)*100).toFixed(1):"0.0";
    const amounts=cfg.customBets.slice(0,cfg.maxLvl);
    let balance = "❌ No token";
    const balResult = await getLiveBalance(userId);
    if(balResult.success) balance = "₹"+balResult.balance;
    else if (balResult.message) balance = "⚠️ "+balResult.message;
    send(chatId,"💰 PROFIT REPORT\n\nBalance: "+balance+"\nBets   : "+pt.totalBets+"\nWins   : "+pt.wins+"\nLoss   : "+pt.losses+"\nRate   : "+rate+"%\nP&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\nBest W : "+pt.maxW+" | Worst L: "+pt.maxL+"\n\nMart: ₹"+amounts.join("→₹"));
}
async function autobetStatus(chatId, userId) {
    initUser(userId);
    const cfg = autobetCfg[userId], st = autobetState[userId], pt = profitTrack[userId];
    const amounts = cfg.customBets.slice(0, cfg.maxLvl);
    const creds = userCreds[userId] || {};
    let liveBal = "❌ No token";
    let token = getToken(userId);
    if (token && token.length > 20) {
        const result = await getLiveBalance(userId);
        if (result.success) liveBal = "₹" + result.balance;
        else liveBal = "⚠️ " + result.message;
    } else if (creds.phone) liveBal = "❌ Login Required";
    let waitLine = "";
    if (st.isWaiting) {
        const diff = Math.round((st.nextStartTime - Date.now()) / 60000);
        waitLine = "\n⏳ Waiting: " + diff + " mins to restart";
    }
    send(chatId,"🤖 AUTOBET STATUS\n\n💰 Live Balance: "+liveBal+"\nEnabled  : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\nToken    : "+(token.length>20?"✅":"❌")+"\nAutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌")+"\nWatch    : "+(cfg.watch?"ON":"OFF")+"\nWatchLoss: "+st.consecutiveLoss+"/"+cfg.watchLoss+"\nBase Bet : ₹"+cfg.baseBet+"\nMax Level: "+cfg.maxLvl+"\nTarget Profit: ₹"+cfg.targetProfit+"\nSection Delay: "+cfg.restartDelay+" mins"+waitLine+"\nIn Mart  : "+(st.inMart?"YES":"NO")+"\nP&L      : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n\nMart: ₹"+amounts.join("→₹"));
}

// ============================================================
//  KEYBOARDS
// ============================================================
function userMenu(id){
    const rows=[["▶️ Start Prediction","🛑 Stop"],["📊 Stats","💰 Profit","📩 Contact"],["🤖 AutoBet Setup","🔑 My Token"]];
    if(isAdmin(id))rows.push(["👑 Admin Panel"]);
    return{keyboard:rows,resize_keyboard:true};
}
const ownerMenu={keyboard:[["👥 All Users","👮 All Admins"],["👤 Add Admin","🗑 Remove Admin"],["🔑 Generate Key","📋 All Keys"],["🟢 Add User","🔴 Remove User"],["🔐 Set Token","📊 All Status"],["🚪 Owner Logout"]],resize_keyboard:true};
const adminMenu={keyboard:[["👥 Active Users","🔑 Generate Key"],["🟢 Add User","🔴 Remove User"],["📋 All Keys","🚪 Admin Logout"]],resize_keyboard:true};
const autobetMenu={keyboard:[["✅ Enable AutoBet","❌ Disable AutoBet"],["👀 Watch Mode ON","👀 Watch Mode OFF"],["💰 Set Base Bet","📈 Set Max Level"],["🎯 Set Profit Target", "⏳ Set Section Delay"],["🔢 Set Watch Losses","📊 AutoBet Status"],["📝 Set Custom Bets","🔙 Back"]],resize_keyboard:true};

// ============================================================
//  BOT INIT
// ============================================================
let bot;
let pollingRecovery = false;
function recoverPolling(err) {
    if (pollingRecovery || !bot) return;
    pollingRecovery = true;
    bot.stopPolling().catch(() => {});
    setTimeout(() => {
        try { bot.startPolling(); } catch (e) {} finally { pollingRecovery = false; }
    }, 5000);
}
function startBot(){
    if(bot){try{bot.stopPolling();}catch(e){}}
    bot=new TelegramBot(BOT_TOKEN,{polling:{interval:1000,autoStart:true,params:{timeout:30}}});
    bot.on("polling_error",err=>{ if (!err.message.includes("ECONNRESET")) console.error("Poll:", err.message); recoverPolling(err); });
    addHandlers();
    console.log("✅ SIVA BOT running...");
}

async function send(chatId,text,opts={}){
    try{return await bot.sendMessage(chatId,text,opts);}
    catch(e){console.error("send:",e.message?.substr(0,60));}
}
async function sendSticker(chatId,sid){try{await bot.sendSticker(chatId,sid);}catch(e){}}

// ============================================================
//  HANDLERS
// ============================================================
function addHandlers(){
    bot.onText(/\/start/,(msg)=>{
        const id=msg.from.id;initUser(id);
        const status=hasAccess(id)?"✅ ACTIVE — "+daysLeft(id)+"d left":"❌ NO ACCESS";
        send(msg.chat.id,"╔══════════════════════════╗\n║  👑EARN WITH ME BOT    ║\n╠══════════════════════════╣\n║ Status : "+status+"\n║ ID     : "+id+"\n║ Admin  : "+ADMIN_HANDLE+"\n╠══════════════════════════╣\n║ /key CODE to activate    ║\n╚══════════════════════════╝",{reply_markup:userMenu(id)});
    });

    bot.onText(/\/key (.+)/,(msg,match)=>{
        const id=msg.from.id;initUser(id);
        const res=activateKey(id,match[1].trim());
        if(res.ok){send(msg.chat.id,"🎊 KEY ACTIVATED!\n⏳ "+res.days+" days\n📅 "+res.expiry,{reply_markup:userMenu(id)});send(OWNER_ID,"🔔 Key used!\nUser: "+id+"\nDays: "+res.days);}
        else send(msg.chat.id,res.msg);
    });

    bot.onText(/\/setcreds (.+)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const parts=match[1].trim().split(/\s+/);
        if(parts.length<2)return send(id,"❌ Format:\n/setcreds FULLPHONE PASSWORD");
        const phone=parts[0],pass=parts.slice(1).join(" ");
        if(!userCreds[id])userCreds[id]={};
        userCreds[id].phone=phone;userCreds[id].pass=pass;
        send(id,"✅ Saved!\n📱 "+phone+"\n🔄 Testing login...");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/setmytoken (.+)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const tok=match[1].trim().replace(/^Bearer\s+/i,"");
        if(tok.length<20)return send(id,"❌ Token too short!");
        userTokens[id]=tok;
        send(id,"✅ Token saved!\n..."+tok.slice(-12)+"\n\n🤖 AutoBet Setup → ✅ Enable");
    });

    bot.onText(/\/login/,(msg)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        send(id,"🔄 Logging in...");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/owner/,(msg)=>{
        if(msg.from.id!==OWNER_ID)return;
        if(ownerLoggedIn)return send(OWNER_ID,"Already in!",{reply_markup:ownerMenu});
        ownerState={action:"login"};send(OWNER_ID,"👑 Owner password:");
    });

    bot.onText(/\/adminlogin (.+)/,(msg,match)=>{
        const id=msg.from.id,pass=match[1].trim();
        if(!isAdmin(id))return send(id,"Not admin.");
        if(pass===adminPasswords[id]){adminLoggedIn[id]=true;send(id,"✅ Admin Login!",{reply_markup:userMenu(id)});}
        else send(id,"❌ Wrong!");
    });

    bot.on("message",async msg=>{
        const id=msg.from.id,text=msg.text;
        if(!text||text.startsWith("/"))return;
        initUser(id);

        if(id===OWNER_ID&&ownerState){
            const s=ownerState;
            if(s.action==="login"){if(text===OWNER_PASS){ownerLoggedIn=true;ownerState=null;return send(OWNER_ID,"👑 Welcome!",{reply_markup:ownerMenu});}else return send(OWNER_ID,"❌ Wrong!");}
            if(s.action==="addadmin"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(OWNER_ID,"❌");ownerState={action:"addadmin",step2:true,tid:t};return send(OWNER_ID,"ID:"+t+"\nPassword:");}else{adminPasswords[s.tid]=text;adminLoggedIn[s.tid]=false;ownerState=null;send(OWNER_ID,"✅ Admin: "+s.tid,{reply_markup:ownerMenu});send(s.tid,"🎉 Admin!\n/adminlogin "+text);return;}}
            else if(s.action==="removeadmin"){const t=parseInt(text);delete adminPasswords[t];delete adminLoggedIn[t];ownerState=null;send(OWNER_ID,"🚫 Removed",{reply_markup:ownerMenu});return;}
            else if(s.action==="genkey"){const d=parseInt(text);const k=generateKey(d,OWNER_ID);ownerState=null;return send(OWNER_ID,"🔑 Key:\n\n"+k+"\n\n"+d+"d\n/key "+k,{reply_markup:ownerMenu});}
            else if(s.action==="adduser"){if(!s.step2){const t=parseInt(text);ownerState={action:"adduser",step2:true,tid:t};return send(OWNER_ID,"ID:"+t+"\nDays?");}else{const d=parseInt(text);usersAccess[s.tid]=Date.now()+d*86400000;ownerState=null;send(OWNER_ID,"✅ "+s.tid+" "+d+"d",{reply_markup:ownerMenu});send(s.tid,"🎊 VIP! "+d+" days\n▶️ Start Prediction!");return;}}
            else if(s.action==="removeuser"){const t=parseInt(text);delete usersAccess[t];running[t]=false;ownerState=null;send(OWNER_ID,"🚫 Removed",{reply_markup:ownerMenu});return;}
            else if(s.action==="settoken"){GLOBAL_TOKEN=text.trim().replace(/^Bearer\s+/i,"");ownerState=null;return send(OWNER_ID,"✅ Global Token set!",{reply_markup:ownerMenu});}
        }

        if(id===OWNER_ID&&ownerLoggedIn){
            if(text==="👥 All Users")    return send(OWNER_ID,"👥\n\n"+activeUsersList());
            if(text==="👮 All Admins")   return send(OWNER_ID,"👮\n\n"+adminList());
            if(text==="👤 Add Admin")    {ownerState={action:"addadmin"};return send(OWNER_ID,"User ID:");}
            if(text==="🗑 Remove Admin") {ownerState={action:"removeadmin"};return send(OWNER_ID,"Admin ID:");}
            if(text==="🔑 Generate Key") {ownerState={action:"genkey"};return send(OWNER_ID,"Days?");}
            if(text==="📋 All Keys")     return send(OWNER_ID,"📋\n\n"+allKeysList());
            if(text==="🟢 Add User")     {ownerState={action:"adduser"};return send(OWNER_ID,"User ID:");}
            if(text==="🔴 Remove User")  {ownerState={action:"removeuser"};return send(OWNER_ID,"User ID?");}
            if(text==="🔐 Set Token")    {ownerState={action:"settoken"};return send(OWNER_ID,"Token paste:");}
            if(text==="📊 All Status")    {
                const ids = Object.keys(usersAccess);
                let report = "📊 TEAM MEMBERS STATUS 📊\n\n";
                ids.forEach(uid => {
                    initUser(uid);
                    const pt = profitTrack[uid];
                    report += `👤 ID: ${uid} | Profit: ₹${(pt.pnl || 0).toFixed(2)}\n`;
                });
                return send(OWNER_ID, report);
            }
            if(text==="🚪 Owner Logout") {ownerLoggedIn=false;return send(OWNER_ID,"🚪 Logged out.",{reply_markup:userMenu(id)});}
        }

        if(text==="▶️ Start Prediction"){
            if(!hasAccess(id))return send(id,"❌ No access.");
            if(running[id])return send(id,"Already running!");
            running[id]=true;send(id,"🚀 Prediction Started!",{reply_markup:userMenu(id)});runPredict(id,msg.chat.id);
        }
        if(text==="🛑 Stop"){running[id]=false;send(id,"🛑 Prediction Stopped.",{reply_markup:userMenu(id)});}
        if(text==="📊 Stats") showStats(msg.chat.id,id);
        if(text==="💰 Profit") profitReport(msg.chat.id,id);
        if(text==="📩 Contact") send(id,"Admin: "+ADMIN_HANDLE);
        if(text==="🤖 AutoBet Setup") send(id,"🤖 AUTOBET SETUP",{reply_markup:autobetMenu});
        if(text==="🔑 My Token") send(id,"🔑 Your Token:\n\n"+(userTokens[id]||"Not set")+"\n\n/setmytoken TOKEN");
        if(text==="🔙 Back") send(id,"Main Menu",{reply_markup:userMenu(id)});

        if(text==="✅ Enable AutoBet"){autobetCfg[id].enabled=true;send(id,"✅ AutoBet Enabled!");}
        if(text==="❌ Disable AutoBet"){autobetCfg[id].enabled=false;send(id,"❌ AutoBet Disabled.");}
        if(text==="👀 Watch Mode ON"){autobetCfg[id].watch=true;send(id,"👀 Watch Mode ON!");}
        if(text==="👀 Watch Mode OFF"){autobetCfg[id].watch=false;send(id,"👀 Watch Mode OFF.");}
        if(text==="📊 AutoBet Status") autobetStatus(msg.chat.id,id);
    });
}

startBot();
