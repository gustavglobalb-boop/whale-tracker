// ============================================================
// MONITOR DE BALEIAS v3.0 — Smart Money Avançado + LIVE DATA
// Foco: Ouro, Petróleo, Prata, Índices, Ações & Crypto Selecionado
// APIs: CoinGecko (crypto, grátis) + Finnhub (ações/commodities)
// Idioma: Português (BR)
// ============================================================

// ===================== LIVE DATA MANAGER =====================
const LiveData = {
    // Finnhub symbol mapping for each TOKENS entry
    finnhubMap: {
        'XAU/USD': 'OANDA:XAU_USD',
        'XAG/USD': 'OANDA:XAG_USD',
        'WTI':     'OANDA:WTICO_USD',
        'BRENT':   'OANDA:BCO_USD',
        'NG':      'OANDA:NATGAS_USD',
        'COPPER':  'OANDA:COPPER_USD',
        // Indices via ETFs (Finnhub free doesn't have direct index quotes)
        'US500':   'SPY',
        'US30':    'DIA',
        'US100':   'QQQ',
        'HK50':    'EWH',   // Hong Kong ETF proxy
        'DAX':     'EWG',   // Germany ETF proxy
        'FTSE':    'EWU',   // UK ETF proxy
        'NIKKEI':  'EWJ',   // Japan ETF proxy
        // Direct stocks
        'AAPL':'AAPL','MSFT':'MSFT','NVDA':'NVDA','TSLA':'TSLA',
        'AMZN':'AMZN','META':'META','GOOGL':'GOOGL','JPM':'JPM','GS':'GS',
    },
    // ETF-to-index multiplier (approximate)
    indexMultiplier: {
        'US500': 10.1,   // SPY ~553 * 10.1 ≈ 5580
        'US30':  97.5,   // DIA ~430 * 97.5 ≈ 41900
        'US100': 49.0,   // QQQ ~396 * 49 ≈ 19404
        'HK50':  720,    // EWH ~32 * 720 ≈ 23040
        'DAX':   625,    // EWG ~36 * 625 ≈ 22500
        'FTSE':  274,    // EWU ~31.5 * 274 ≈ 8600
        'NIKKEI': 530,   // EWJ ~70 * 530 ≈ 37100
    },
    // CoinGecko IDs
    cryptoIds: {
        'BTC/USD': 'bitcoin',
        'ETH/USD': 'ethereum',
        'XRP/USD': 'ripple',
        'BNB/USD': 'binancecoin',
        'TRX/USD': 'tron',
        'SOL/USD': 'solana',
    },
    cache: {},
    CACHE_TTL: 30000, // 30s cache
    isLive: { crypto: false, stocks: false },
    lastFetch: { crypto: 0, stocks: 0 },

    getApiKeys() {
        try { return JSON.parse(localStorage.getItem('whalevault_api_keys') || '{}'); }
        catch(e) { return {}; }
    },

    isCached(key) {
        return this.cache[key] && (Date.now() - this.cache[key].ts < this.CACHE_TTL);
    },

    // ---- CRYPTO via CoinGecko (NO KEY NEEDED) ----
    async fetchCryptoPrices() {
        const cacheKey = 'crypto_prices';
        if (this.isCached(cacheKey)) return this.cache[cacheKey].data;
        const ids = Object.values(this.cryptoIds).join(',');
        try {
            const keys = this.getApiKeys();
            let url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
            const headers = {};
            if (keys.coingecko) {
                url = `https://pro-api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
                headers['x-cg-pro-api-key'] = keys.coingecko;
            }
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
            const data = await res.json();
            this.cache[cacheKey] = { data, ts: Date.now() };
            this.isLive.crypto = true;
            return data;
        } catch(e) {
            console.warn('CoinGecko error:', e.message);
            this.isLive.crypto = false;
            return null;
        }
    },

    // ---- STOCKS/COMMODITIES via Finnhub ----
    async fetchFinnhubQuote(symbol) {
        const keys = this.getApiKeys();
        if (!keys.finnhub) return null;
        const finnSymbol = this.finnhubMap[symbol];
        if (!finnSymbol) return null;
        const cacheKey = 'fh_' + finnSymbol;
        if (this.isCached(cacheKey)) return this.cache[cacheKey].data;
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnSymbol)}&token=${keys.finnhub}`);
            if (!res.ok) throw new Error(`Finnhub ${res.status}`);
            const data = await res.json();
            if (!data.c || data.c === 0) return null;
            this.cache[cacheKey] = { data, ts: Date.now() };
            this.isLive.stocks = true;
            return data;
        } catch(e) {
            console.warn(`Finnhub error for ${symbol}:`, e.message);
            return null;
        }
    },

    // ---- FEAR & GREED INDEX (crypto) ----
    async fetchFearGreed() {
        const cacheKey = 'fear_greed';
        if (this.isCached(cacheKey)) return this.cache[cacheKey].data;
        try {
            const res = await fetch('https://api.alternative.me/fng/?limit=1');
            if (!res.ok) throw new Error('FnG error');
            const data = await res.json();
            const value = parseInt(data.data[0].value);
            this.cache[cacheKey] = { data: value, ts: Date.now() };
            return value;
        } catch(e) {
            console.warn('Fear&Greed error:', e.message);
            return null;
        }
    },

    // ---- MAIN SYNC: Update all tokens with live prices ----
    async syncAll() {
        let updatedCount = 0;
        // 1. Crypto via CoinGecko
        const cryptoData = await this.fetchCryptoPrices();
        if (cryptoData) {
            for (const [symbol, geckoId] of Object.entries(this.cryptoIds)) {
                const d = cryptoData[geckoId];
                if (!d) continue;
                const token = state.tokens.find(t => t.symbol === symbol);
                if (!token) continue;
                const oldPrice = token.price;
                token.price = d.usd;
                token.change24h = d.usd_24h_change || token.change24h;
                token.mcap = d.usd_market_cap || token.mcap;
                token._vol24h = d.usd_24h_vol || 0;
                token._live = true;
                updatedCount++;
            }
        }
        // 2. Stocks/Commodities via Finnhub (rate-limited: batch with delays)
        const keys = this.getApiKeys();
        if (keys.finnhub) {
            const nonCrypto = state.tokens.filter(t => t.market !== 'crypto');
            for (let i = 0; i < nonCrypto.length; i++) {
                const token = nonCrypto[i];
                const quote = await this.fetchFinnhubQuote(token.symbol);
                if (quote && quote.c > 0) {
                    let price = quote.c;
                    // Apply index multiplier for ETF proxies
                    if (this.indexMultiplier[token.symbol]) {
                        price = price * this.indexMultiplier[token.symbol];
                    }
                    token.price = price;
                    // dp = daily percent change
                    if (quote.dp !== undefined && quote.dp !== null) {
                        token.change24h = quote.dp;
                    } else if (quote.pc > 0) {
                        token.change24h = ((quote.c - quote.pc) / quote.pc) * 100;
                    }
                    token._prevClose = quote.pc;
                    token._high = quote.h;
                    token._low = quote.l;
                    token._live = true;
                    updatedCount++;
                }
                // Respect rate limit: ~15 calls/sec to be safe
                if (i < nonCrypto.length - 1) {
                    await new Promise(r => setTimeout(r, 80));
                }
            }
        }
        // 3. Fear & Greed
        const fng = await this.fetchFearGreed();
        if (fng !== null) state.fearGreedIndex = fng;

        // Update mode badge
        const anyLive = this.isLive.crypto || this.isLive.stocks;
        const badge = document.getElementById('mode-badge');
        const dot = badge.querySelector('.mode-dot');
        const label = badge.querySelector('.mode-label');
        if (this.isLive.crypto && this.isLive.stocks) {
            label.textContent = '🟢 LIVE';
            badge.style.background = 'rgba(16,185,129,0.15)';
            badge.style.borderColor = 'rgba(16,185,129,0.3)';
        } else if (anyLive) {
            label.textContent = '🟡 PARCIAL';
            badge.style.background = 'rgba(245,158,11,0.15)';
            badge.style.borderColor = 'rgba(245,158,11,0.3)';
        } else {
            label.textContent = 'DEMO';
            badge.style.background = '';
            badge.style.borderColor = '';
        }

        // Update status
        const statusEl = document.getElementById('api-status');
        if (statusEl) {
            const parts = [];
            if (this.isLive.crypto) parts.push('✅ Crypto (CoinGecko)');
            else parts.push('⬜ Crypto (sem conexão)');
            if (this.isLive.stocks) parts.push('✅ Ações/Commodities (Finnhub)');
            else parts.push('⬜ Ações/Commodities (sem chave Finnhub)');
            statusEl.innerHTML = parts.join(' &nbsp;|&nbsp; ');
        }

        return updatedCount;
    }
};

// ---- ATIVOS MULTI-MERCADO ----
const TOKENS = [
    // COMMODITIES
    { symbol: 'XAU/USD', name: 'Ouro', price: 3085.40, mcap: 0, change24h: 1.12, change7d: 3.45, classe: 'Commodity', market: 'commodities', icon: '🥇' },
    { symbol: 'XAG/USD', name: 'Prata', price: 34.28, mcap: 0, change24h: -0.67, change7d: 2.10, classe: 'Commodity', market: 'commodities', icon: '🥈' },
    { symbol: 'WTI', name: 'Petróleo Bruto', price: 69.45, mcap: 0, change24h: -1.34, change7d: -3.20, classe: 'Commodity', market: 'commodities', icon: '🛢️' },
    { symbol: 'BRENT', name: 'Petróleo Brent', price: 73.12, mcap: 0, change24h: -0.98, change7d: -2.80, classe: 'Commodity', market: 'commodities', icon: '🛢️' },
    { symbol: 'NG', name: 'Gás Natural', price: 4.12, mcap: 0, change24h: 2.45, change7d: 5.60, classe: 'Commodity', market: 'commodities', icon: '🔥' },
    { symbol: 'COPPER', name: 'Cobre', price: 5.02, mcap: 0, change24h: 0.78, change7d: 4.30, classe: 'Commodity', market: 'commodities', icon: '🔶' },
    // ÍNDICES
    { symbol: 'US500', name: 'S&P 500', price: 5580.25, mcap: 0, change24h: 0.45, change7d: 1.23, classe: 'Índice', market: 'indices', icon: '🇺🇸' },
    { symbol: 'US30', name: 'Dow Jones', price: 41890.50, mcap: 0, change24h: 0.62, change7d: 0.89, classe: 'Índice', market: 'indices', icon: '🇺🇸' },
    { symbol: 'US100', name: 'Nasdaq 100', price: 19420.80, mcap: 0, change24h: -0.34, change7d: 2.15, classe: 'Índice', market: 'indices', icon: '🇺🇸' },
    { symbol: 'HK50', name: 'Hang Seng', price: 23150.40, mcap: 0, change24h: 1.89, change7d: 4.56, classe: 'Índice', market: 'indices', icon: '🇭🇰' },
    { symbol: 'DAX', name: 'DAX 40', price: 22580.30, mcap: 0, change24h: -0.23, change7d: 1.45, classe: 'Índice', market: 'indices', icon: '🇩🇪' },
    { symbol: 'FTSE', name: 'FTSE 100', price: 8650.70, mcap: 0, change24h: 0.15, change7d: 0.67, classe: 'Índice', market: 'indices', icon: '🇬🇧' },
    { symbol: 'NIKKEI', name: 'Nikkei 225', price: 37240.10, mcap: 0, change24h: -1.12, change7d: -2.30, classe: 'Índice', market: 'indices', icon: '🇯🇵' },
    // AÇÕES
    { symbol: 'AAPL', name: 'Apple', price: 217.90, mcap: 3340000000000, change24h: 0.67, change7d: 2.34, classe: 'Ação', market: 'equities', icon: '🍎' },
    { symbol: 'MSFT', name: 'Microsoft', price: 420.50, mcap: 3120000000000, change24h: 1.23, change7d: 3.45, classe: 'Ação', market: 'equities', icon: '💻' },
    { symbol: 'NVDA', name: 'NVIDIA', price: 112.80, mcap: 2750000000000, change24h: -2.15, change7d: -5.30, classe: 'Ação', market: 'equities', icon: '🎮' },
    { symbol: 'TSLA', name: 'Tesla', price: 268.40, mcap: 855000000000, change24h: 3.45, change7d: 8.90, classe: 'Ação', market: 'equities', icon: '🚗' },
    { symbol: 'AMZN', name: 'Amazon', price: 198.30, mcap: 2050000000000, change24h: 0.89, change7d: 1.56, classe: 'Ação', market: 'equities', icon: '📦' },
    { symbol: 'META', name: 'Meta', price: 585.20, mcap: 1480000000000, change24h: -0.56, change7d: 2.10, classe: 'Ação', market: 'equities', icon: '👤' },
    { symbol: 'GOOGL', name: 'Alphabet', price: 163.70, mcap: 2010000000000, change24h: 0.34, change7d: 1.89, classe: 'Ação', market: 'equities', icon: '🔍' },
    { symbol: 'JPM', name: 'JP Morgan', price: 245.80, mcap: 710000000000, change24h: 0.78, change7d: 3.20, classe: 'Ação', market: 'equities', icon: '🏦' },
    { symbol: 'GS', name: 'Goldman Sachs', price: 540.30, mcap: 178000000000, change24h: -0.45, change7d: 1.23, classe: 'Ação', market: 'equities', icon: '🏦' },
    // CRYPTO (apenas 6 selecionados)
    { symbol: 'BTC/USD', name: 'Bitcoin', price: 87432, mcap: 1720000000000, change24h: 2.34, change7d: 5.12, classe: 'Crypto', market: 'crypto', icon: '₿' },
    { symbol: 'ETH/USD', name: 'Ethereum', price: 3245, mcap: 390000000000, change24h: -1.23, change7d: 3.45, classe: 'Crypto', market: 'crypto', icon: 'Ξ' },
    { symbol: 'XRP/USD', name: 'Ripple', price: 2.34, mcap: 134000000000, change24h: -0.45, change7d: 1.23, classe: 'Crypto', market: 'crypto', icon: '💎' },
    { symbol: 'BNB/USD', name: 'Binance Coin', price: 612, mcap: 91000000000, change24h: 0.89, change7d: -2.10, classe: 'Crypto', market: 'crypto', icon: '🟡' },
    { symbol: 'TRX/USD', name: 'TRON', price: 0.238, mcap: 21500000000, change24h: 1.56, change7d: 4.30, classe: 'Crypto', market: 'crypto', icon: '⚡' },
    { symbol: 'SOL/USD', name: 'Solana', price: 178.5, mcap: 82000000000, change24h: 4.56, change7d: 12.30, classe: 'Crypto', market: 'crypto', icon: '☀️' },
];

const WHALE_NAMES = [
    'Bridgewater Associates', 'BlackRock', 'Vanguard', 'Citadel', 'Renaissance Technologies',
    'Goldman Sachs Trading', 'JP Morgan Asset Mgmt', 'Fundo Soberano Norueguês', 'Fundo Soberano Abu Dhabi',
    'Berkshire Hathaway', 'PIMCO', 'Two Sigma', 'D.E. Shaw', 'Millennium Management',
    'Point72', 'Baleia Anônima', 'Fundo Institucional', 'Cripto Baleia #1', 'Hedge Fund Alpha'
];
const TX_TYPES = ['compra', 'venda', 'posição', 'hedge'];
const SUBREDDITS = ['wallstreetbets', 'stocks', 'CryptoCurrency', 'commodities', 'Gold'];
const TOPICS = [
    'ouro refúgio', 'petróleo OPEC', 'corte Fed', 'inflação', 'recessão', 'guerra comercial',
    'China estímulo', 'dólar forte', 'treasuries', 'ações tech', 'S&P 500 máxima',
    'prata industrial', 'ETF ouro', 'position sizing', 'hedge geopolítico',
    'HK50 rally', 'earnings season', 'dados emprego', 'CPI surpresa', 'yield curve',
    'smart money', 'COT report', 'fluxo institucional', 'short squeeze', 'rotação setorial'
];

// ---- FONTES DE DADOS ----
const DATA_SOURCES = [
    { name: 'Whale Alert', icon: '🐋', type: 'Rastreio de Baleias Crypto', desc: 'Monitoramento em tempo real de transações grandes em blockchain. Detecta movimentos de BTC, ETH e outras criptos entre carteiras e exchanges.', tags: ['crypto', 'blockchain', 'transações', 'tempo real'], url: 'https://whale-alert.io', status: 'active' },
    { name: 'WhaleWisdom', icon: '🏦', type: 'Posições Institucionais (13F)', desc: 'Rastreia relatórios SEC 13F de hedge funds e gestores institucionais. Veja o que Buffett, Dalio e Soros estão comprando e vendendo.', tags: ['ações', 'hedge funds', '13F', 'SEC', 'institucional'], url: 'https://whalewisdom.com', status: 'active' },
    { name: 'CFTC COT Report', icon: '📊', type: 'Posicionamento de Futuros', desc: 'Commitment of Traders — posicionamento de comerciais, grandes especuladores e small traders em futuros de ouro, petróleo, prata e índices.', tags: ['commodities', 'futuros', 'ouro', 'petróleo', 'COT'], url: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders', status: 'active' },
    { name: 'Finviz', icon: '📈', type: 'Screener & Mapa de Mercado', desc: 'Screener avançado de ações com mapa de calor do mercado, insider trading, e análise fundamentalista para ações dos EUA.', tags: ['ações', 'screener', 'insider', 'heatmap'], url: 'https://finviz.com', status: 'active' },
    { name: 'TradingView', icon: '📉', type: 'Gráficos & Análise Técnica', desc: 'Plataforma líder de gráficos com dados em tempo real para commodities, índices, ações e crypto. Ideias da comunidade de traders.', tags: ['gráficos', 'análise técnica', 'multi-ativo', 'comunidade'], url: 'https://tradingview.com', status: 'active' },
    { name: 'Koyfin', icon: '💹', type: 'Terminal Financeiro', desc: 'Terminal estilo Bloomberg gratuito. Dados macro, métricas de valuation, screening avançado e dashboards customizáveis.', tags: ['macro', 'fundamental', 'terminal', 'valuation'], url: 'https://koyfin.com', status: 'active' },
    { name: 'Unusual Whales', icon: '🦑', type: 'Fluxo de Opções & Dark Pool', desc: 'Detecta atividade incomum em opções de ações e fluxo de dark pool. Identifica apostas grandes de smart money em equities.', tags: ['opções', 'dark pool', 'smart money', 'ações'], url: 'https://unusualwhales.com', status: 'active' },
    { name: 'Hyperliquid', icon: '⚡', type: 'Perpetuals & Open Interest', desc: 'API pública com posições de perps, open interest e trades de baleias em crypto. Sem necessidade de API key.', tags: ['crypto', 'perps', 'open interest', 'DeFi'], url: 'https://hyperliquid.xyz', status: 'active' },
    { name: 'Reddit Sentiment', icon: '💬', type: 'Inteligência Social', desc: 'Análise de sentimento de r/wallstreetbets, r/stocks, r/commodities e r/Gold. Detecta tendências e narrativas emergentes.', tags: ['sentimento', 'social', 'Reddit', 'análise'], url: 'https://reddit.com', status: 'active' },
    { name: 'World Gold Council', icon: '🥇', type: 'Dados de Ouro Institucional', desc: 'Dados sobre demanda e oferta global de ouro, compras de bancos centrais, fluxos de ETF de ouro e reservas de países.', tags: ['ouro', 'banco central', 'ETF', 'reservas'], url: 'https://www.gold.org', status: 'active' },
    { name: 'OPEC Monthly Report', icon: '🛢️', type: 'Relatórios de Petróleo', desc: 'Relatórios mensais da OPEC com projeções de oferta/demanda, produção por país e impacto em preços do petróleo.', tags: ['petróleo', 'OPEC', 'produção', 'relatório'], url: 'https://www.opec.org', status: 'active' },
    { name: 'Fear & Greed Index', icon: '😱', type: 'Sentimento de Mercado', desc: 'Índice CNN de Medo e Ganância para ações e Alternative.me para crypto. Termômetro do sentimento de mercado.', tags: ['sentimento', 'medo', 'ganância', 'mercado'], url: 'https://edition.cnn.com/markets/fear-and-greed', status: 'active' },
];

// ---- UTILIDADES ----
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max)); }
function randEl(arr) { return arr[randInt(0, arr.length)]; }
function randAddr() { return '0x' + Array.from({length: 40}, () => '0123456789abcdef'[randInt(0,16)]).join(''); }
function shortAddr(a) { return a.startsWith('0x') ? a.slice(0,6) + '...' + a.slice(-4) : a; }
function formatUSD(n) {
    if (n >= 1e12) return '$' + (n/1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
}
function tempoAtras(ms) {
    const s = Math.floor(ms/1000);
    if (s < 60) return s + 's atrás';
    if (s < 3600) return Math.floor(s/60) + 'min atrás';
    return Math.floor(s/3600) + 'h atrás';
}
function generateSparkline(points = 24, base = 100, volatility = 5) {
    const data = [];
    let val = base;
    for (let i = 0; i < points; i++) { val += rand(-volatility, volatility); data.push(Math.max(0, val)); }
    return data;
}

function generateWhaleAlert() {
    const token = randEl(TOKENS);
    const amount = rand(500000, 80000000);
    const type = randEl(TX_TYPES);
    const impact = amount > 20000000 ? 'high' : amount > 5000000 ? 'medium' : 'low';
    const isInstitutional = token.market !== 'crypto';
    return {
        id: Date.now() + randInt(0, 9999), token: token.symbol, tokenName: token.name,
        market: token.market, amount, type, impact,
        from: isInstitutional ? randEl(WHALE_NAMES) : randAddr(),
        to: isInstitutional ? (type === 'compra' ? 'Acumulação' : type === 'venda' ? 'Redução' : 'Rebalanceamento') : randAddr(),
        time: Date.now() - randInt(0, 3600000),
        whaleName: randEl(WHALE_NAMES)
    };
}

function generateRedditPost() {
    const titles = [
        'Ouro a $3000+, bancos centrais comprando como loucos — prepare-se',
        'Smart money saindo de tech e indo para commodities — COT confirma',
        'Petróleo pode desabar: OPEC ameaça aumentar produção',
        'HK50 rompeu resistência — China injetando estímulo pesado',
        'S&P 500 em máxima histórica mas breadth está horrível',
        'Prata é o trade mais assimétrico de 2026 — aqui os dados',
        'BlackRock comprando ouro físico em volumes recordes',
        'Fluxo de dark pool mostrando acumulação massiva em NVDA',
        'COT Report mostra comerciais acumulando shorts em petróleo',
        'Fed pode cortar juros em junho — impacto nos metais preciosos',
        'Warren Buffett aumentou posição em cash — sinal de topo?',
        'ETF de ouro com maior influxo em 3 anos — dados detalhados',
        'BTC e Ouro correlacionados: ambos são hedge contra fiat',
        'Análise: por que o dólar vai enfraquecer e ouro vai a $3500',
        'Fundos soberanos do Oriente Médio diversificando para ações tech',
    ];
    return {
        title: randEl(titles), subreddit: randEl(SUBREDDITS), upvotes: randInt(50, 5000),
        comments: randInt(20, 800), sentiment: randEl(['positive', 'negative', 'neutral']),
        sentimentScore: rand(-1, 1), time: Date.now() - randInt(0, 86400000),
        author: 'u/' + randEl(['GoldBull2026', 'SmartMoneyTracker', 'OilAnalyst', 'WallStreetInsider', 'CommoditiesKing', 'IndexTraderPro', 'MacroResearcher'])
    };
}

// ---- ESTADO ----
const state = {
    currentSection: 'whale-alerts',
    alerts: [],
    alertsPaused: false,
    trackedWallets: [],
    tokens: JSON.parse(JSON.stringify(TOKENS)),
    posts: [],
    fearGreedIndex: randInt(25, 85),
    sidebarCollapsed: false,
};

// ---- INICIALIZAÇÃO ----
document.addEventListener('DOMContentLoaded', () => {
    for (let i = 0; i < 25; i++) state.alerts.push(generateWhaleAlert());
    state.alerts.sort((a, b) => b.time - a.time);
    for (let i = 0; i < 15; i++) state.posts.push(generateRedditPost());
    setTimeout(() => {
        const splash = document.getElementById('splash-loader');
        const app = document.getElementById('app');
        splash.classList.add('fade-out');
        app.classList.remove('hidden');
        setTimeout(() => { app.classList.add('visible'); splash.remove(); }, 600);
        initApp();
    }, 2200);
});

async function initApp() {
    setupNavigation();
    setupSearch();
    setupSidebar();
    setupSettings();
    renderDataSources();

    // First live sync attempt
    showToast('🔄', 'Conectando às fontes de dados...', 'whale');
    const updated = await LiveData.syncAll();
    if (updated > 0) {
        showToast('✅', `${updated} ativos atualizados com preços reais!`, 'bull');
    } else {
        showToast('ℹ️', 'Modo demo ativo. Configure API keys em Configurações.', 'alert');
    }

    updateTickers();
    renderWhaleAlerts();
    renderMarketOverview();
    renderVolumeScanner();
    renderCohortAnalysis();
    renderCommunityIntel();
    updateAlertStats();
    startLiveUpdates();
    document.getElementById('last-update').textContent = 'Última atualização: agora';
}

// ---- NAVEGAÇÃO ----
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            if (section) navigateTo(section);
        });
    });
    const hash = location.hash.slice(1);
    if (hash) navigateTo(hash);
}

function navigateTo(section) {
    state.currentSection = section;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const navItem = document.querySelector(`[data-section="${section}"]`);
    const sectionEl = document.getElementById('section-' + section);
    if (navItem) navItem.classList.add('active');
    if (sectionEl) sectionEl.classList.add('active');
    location.hash = section;
    document.getElementById('sidebar').classList.remove('mobile-open');
}

// ---- SIDEBAR ----
function setupSidebar() {
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (window.innerWidth <= 768) { sidebar.classList.toggle('mobile-open'); }
        else { sidebar.classList.toggle('collapsed'); }
    });
}

// ---- BUSCA ----
function setupSearch() {
    const modal = document.getElementById('search-modal');
    const input = document.getElementById('search-input');
    document.getElementById('search-trigger').addEventListener('click', () => openSearch());
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
        if (e.key === 'Escape') modal.classList.add('hidden');
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    input.addEventListener('input', () => renderSearchResults(input.value));
    function openSearch() { modal.classList.remove('hidden'); input.focus(); input.value = ''; renderSearchResults(''); }
}

function renderSearchResults(query) {
    const container = document.getElementById('search-results');
    if (!query) { container.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:0.85rem;">Digite para buscar ativos, seções ou tópicos...</div>`; return; }
    const q = query.toLowerCase();
    const matches = state.tokens.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)).slice(0, 8);
    let html = '';
    matches.forEach(t => {
        const cc = t.change24h >= 0 ? 'positive-text' : 'negative-text';
        const liveTag = t._live ? ' 🟢' : '';
        html += `<div class="search-result-item" onclick="navigateTo('market-overview');document.getElementById('search-modal').classList.add('hidden')">
            <span class="result-icon">${t.icon || '💰'}</span>
            <div class="result-info"><div class="result-name">${t.symbol}${liveTag}</div><div class="result-meta">${t.name} • ${formatUSD(t.price)} • ${t.classe}</div></div>
            <span class="${cc}" style="font-family:var(--font-mono);font-size:0.8rem">${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%</span>
        </div>`;
    });
    container.innerHTML = html || `<div style="padding:16px;color:var(--text-muted);font-size:0.85rem;">Nenhum resultado para "${query}"</div>`;
}

// ---- TICKERS ----
function updateTickers() {
    const gold = state.tokens.find(t => t.symbol === 'XAU/USD');
    const oil = state.tokens.find(t => t.symbol === 'WTI');
    const btc = state.tokens.find(t => t.symbol === 'BTC/USD');
    const sp = state.tokens.find(t => t.symbol === 'US500');
    setTicker('gold', gold); setTicker('oil', oil); setTicker('btc', btc); setTicker('us500', sp);
    const fng = state.fearGreedIndex;
    document.getElementById('fng-value').textContent = fng;
    const fngLabel = document.getElementById('fng-label');
    const label = fng <= 25 ? 'Medo Extremo' : fng <= 45 ? 'Medo' : fng <= 55 ? 'Neutro' : fng <= 75 ? 'Ganância' : 'Ganância Extrema';
    fngLabel.textContent = label;
    fngLabel.className = 'ticker-change ' + (fng >= 50 ? 'positive' : 'negative');
}

function setTicker(id, token) {
    document.getElementById('price-' + id).textContent = formatUSD(token.price);
    const changeEl = document.getElementById('change-' + id);
    changeEl.textContent = (token.change24h >= 0 ? '+' : '') + token.change24h.toFixed(2) + '%';
    changeEl.className = 'ticker-change ' + (token.change24h >= 0 ? 'positive' : 'negative');
}

// ---- ALERTAS DE BALEIAS ----
function renderWhaleAlerts() {
    const feed = document.getElementById('alert-feed');
    feed.innerHTML = state.alerts.map(a => {
        const mktLabel = {commodities:'🥇 COMMODITY', indices:'📊 ÍNDICE', equities:'📈 AÇÃO', crypto:'₿ CRYPTO'}[a.market] || a.market;
        const isInst = a.market !== 'crypto';
        return `<div class="alert-item" data-chain="${a.market}" data-impact="${a.impact}">
            <div class="alert-impact ${a.impact}">${a.impact === 'high' ? '🔴' : a.impact === 'medium' ? '🟡' : '🟢'}</div>
            <div class="alert-info">
                <div class="alert-title">
                    <span class="amount">${formatUSD(a.amount)}</span> ${a.token}
                    <span class="alert-chain-tag ${a.market}">${mktLabel}</span>
                </div>
                <div class="alert-detail">
                    <span>${a.whaleName}</span>
                    <span class="addr">${isInst ? a.type.toUpperCase() + ' → ' + a.to : shortAddr(a.from) + ' → ' + shortAddr(a.to)}</span>
                </div>
            </div>
            <div class="alert-meta">
                <div class="alert-time">${tempoAtras(Date.now() - a.time)}</div>
                <span class="alert-type-tag ${a.type}">${a.type}</span>
            </div>
        </div>`;
    }).join('');
    document.getElementById('alert-count').textContent = state.alerts.length;
    document.getElementById('alert-chain-filter').onchange = document.getElementById('alert-impact-filter').onchange = filterAlerts;
    document.getElementById('alert-pause').onclick = () => {
        state.alertsPaused = !state.alertsPaused;
        document.getElementById('alert-pause').classList.toggle('active', state.alertsPaused);
    };
}

function filterAlerts() {
    const chain = document.getElementById('alert-chain-filter').value;
    const impact = document.getElementById('alert-impact-filter').value;
    document.querySelectorAll('.alert-item').forEach(item => {
        const mc = chain === 'all' || item.dataset.chain === chain;
        const mi = impact === 'all' || item.dataset.impact === impact;
        item.style.display = mc && mi ? '' : 'none';
    });
}

function updateAlertStats() {
    const last24h = state.alerts.filter(a => Date.now() - a.time < 86400000);
    document.getElementById('stat-total-txns').textContent = last24h.length;
    document.getElementById('stat-volume-moved').textContent = formatUSD(last24h.reduce((s, a) => s + a.amount, 0));
    document.getElementById('stat-largest-txn').textContent = formatUSD(Math.max(...last24h.map(a => a.amount), 0));
    document.getElementById('stat-active-whales').textContent = new Set(last24h.map(a => a.whaleName)).size;
}

// ---- VISÃO DE MERCADO ----
function renderMarketOverview() {
    renderHeatmap(); renderMarketTable(); setupMarketToggle();
    const gold = state.tokens.find(t => t.symbol === 'XAU/USD');
    const oil = state.tokens.find(t => t.symbol === 'WTI');
    const sp = state.tokens.find(t => t.symbol === 'US500');
    const btc = state.tokens.find(t => t.symbol === 'BTC/USD');
    document.getElementById('stat-gold-price').textContent = formatUSD(gold.price);
    document.getElementById('stat-oil-price').textContent = formatUSD(oil.price);
    document.getElementById('stat-sp500-price').textContent = formatUSD(sp.price);
    document.getElementById('stat-btc-price').textContent = formatUSD(btc.price);
}

function getHeatmapColor(change) {
    if (change > 8) return 'rgba(16, 185, 129, 0.7)';
    if (change > 5) return 'rgba(16, 185, 129, 0.5)';
    if (change > 2) return 'rgba(16, 185, 129, 0.3)';
    if (change > 0) return 'rgba(16, 185, 129, 0.15)';
    if (change > -2) return 'rgba(239, 68, 68, 0.15)';
    if (change > -5) return 'rgba(239, 68, 68, 0.3)';
    if (change > -8) return 'rgba(239, 68, 68, 0.5)';
    return 'rgba(239, 68, 68, 0.7)';
}

function renderHeatmap() {
    document.getElementById('market-heatmap').innerHTML = state.tokens.map(t => {
        const bg = getHeatmapColor(t.change24h);
        const tc = Math.abs(t.change24h) > 5 ? 'white' : 'var(--text-primary)';
        const liveIndicator = t._live ? '🟢 ' : '';
        return `<div class="heatmap-cell" style="background:${bg};color:${tc}" title="${t.name} (${t.classe}): ${formatUSD(t.price)}${t._live ? ' [LIVE]' : ' [DEMO]'}">
            <span class="cell-symbol">${liveIndicator}${t.icon || ''} ${t.symbol}</span>
            <span class="cell-change">${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%</span>
            <span class="cell-price">${formatUSD(t.price)}</span>
        </div>`;
    }).join('');
}

function renderMarketTable() {
    document.getElementById('market-table-body').innerHTML = state.tokens.map((t, i) => {
        const c24 = t.change24h >= 0 ? 'positive-text' : 'negative-text';
        const c7d = t.change7d >= 0 ? 'positive-text' : 'negative-text';
        const liveTag = t._live ? ' 🟢' : '';
        return `<tr>
            <td>${i + 1}</td>
            <td><div class="asset-cell"><span class="asset-symbol">${t.icon || ''} ${t.symbol}${liveTag}</span><span class="asset-name">${t.name}</span></div></td>
            <td>${formatUSD(t.price)}</td>
            <td class="${c24}">${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%</td>
            <td class="${c7d}">${t.change7d >= 0 ? '+' : ''}${t.change7d.toFixed(2)}%</td>
            <td>${t.classe}</td>
            <td>${formatUSD(t._vol24h || (t.mcap > 0 ? t.mcap * rand(0.02, 0.08) : rand(1e8, 5e9)))}</td>
            <td><canvas class="sparkline-canvas" data-idx="${i}"></canvas></td>
        </tr>`;
    }).join('');
    document.querySelectorAll('.sparkline-canvas').forEach(canvas => {
        const idx = parseInt(canvas.dataset.idx);
        const data = generateSparkline(24, 100, 8);
        const ctx = canvas.getContext('2d');
        canvas.width = 80; canvas.height = 30;
        const max = Math.max(...data), min = Math.min(...data);
        ctx.strokeStyle = state.tokens[idx].change24h >= 0 ? '#10b981' : '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        data.forEach((v, j) => {
            const x = (j / (data.length - 1)) * 80;
            const y = 28 - ((v - min) / (max - min || 1)) * 26;
            j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    });
}

function setupMarketToggle() {
    document.querySelectorAll('#market-view-toggle .view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#market-view-toggle .view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            document.getElementById('market-heatmap').classList.toggle('hidden', view !== 'heatmap');
            document.getElementById('market-table-container').classList.toggle('hidden', view !== 'table');
        });
    });
}

// ---- SCANNER DE VOLUME ----
function renderVolumeScanner() {
    const grid = document.getElementById('volume-scanner-grid');
    const volumeData = state.tokens.map(t => {
        const spike = rand(0.5, 8);
        const vol24h = t._vol24h || (t.mcap > 0 ? t.mcap * rand(0.02, 0.1) : rand(1e8, 5e9));
        return { ...t, spike, vol24h, avg7d: vol24h / spike };
    }).sort((a, b) => b.spike - a.spike);
    grid.innerHTML = volumeData.map(v => {
        const sc = v.spike >= 3 ? 'high' : v.spike >= 2 ? 'medium' : 'low';
        return `<div class="volume-card spike-${sc}" onclick="selectVolumeAsset('${v.symbol}')">
            <div class="volume-card-header">
                <span class="volume-asset">${v.icon || ''} ${v.symbol}</span>
                <span class="volume-spike-badge ${sc}">${v.spike.toFixed(1)}x</span>
            </div>
            <div class="volume-card-body">
                <div class="volume-stat"><span class="volume-stat-label">Vol 24h</span><span class="volume-stat-value">${formatUSD(v.vol24h)}</span></div>
                <div class="volume-stat"><span class="volume-stat-label">Média 7d</span><span class="volume-stat-value">${formatUSD(v.avg7d)}</span></div>
                <div class="volume-stat"><span class="volume-stat-label">Preço</span><span class="volume-stat-value">${formatUSD(v.price)}</span></div>
                <div class="volume-stat"><span class="volume-stat-label">Var 24h</span><span class="volume-stat-value ${v.change24h >= 0 ? 'positive-text' : 'negative-text'}">${v.change24h >= 0 ? '+' : ''}${v.change24h.toFixed(2)}%</span></div>
            </div>
        </div>`;
    }).join('');
}

function selectVolumeAsset(symbol) {
    const container = document.getElementById('volume-chart-container');
    document.querySelectorAll('.volume-card').forEach(c => c.classList.remove('selected'));
    const clicked = [...document.querySelectorAll('.volume-card')].find(c => c.querySelector('.volume-asset').textContent.includes(symbol));
    if (clicked) clicked.classList.add('selected');
    container.innerHTML = '';
    const chartDiv = document.createElement('div');
    chartDiv.style.cssText = 'width:100%;height:300px';
    container.appendChild(chartDiv);
    try {
        const chart = LightweightCharts.createChart(chartDiv, {
            width: chartDiv.clientWidth, height: 300,
            layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
            grid: { vertLines: { color: 'rgba(148,163,184,0.06)' }, horzLines: { color: 'rgba(148,163,184,0.06)' } },
            timeScale: { borderColor: 'rgba(148,163,184,0.12)' }, rightPriceScale: { borderColor: 'rgba(148,163,184,0.12)' },
        });
        const vs = chart.addHistogramSeries({ color: '#6366f1', priceFormat: { type: 'volume' } });
        const now = Math.floor(Date.now() / 1000);
        const data = [];
        for (let i = 30; i >= 0; i--) { data.push({ time: now - i * 86400, value: rand(1e6, 1e8), color: i < 3 ? '#ef4444' : '#6366f1' }); }
        vs.setData(data);
        chart.timeScale().fitContent();
        new ResizeObserver(() => chart.applyOptions({ width: chartDiv.clientWidth })).observe(chartDiv);
    } catch(e) { container.innerHTML = `<div class="empty-state small"><p>Carregando gráfico...</p></div>`; }
}

// ---- RASTREIO DE CARTEIRAS ----
(function() {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            const btn = document.getElementById('wallet-search-btn');
            const inp = document.getElementById('wallet-search-input');
            if (btn) btn.addEventListener('click', () => trackWallet(inp.value));
            if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') trackWallet(inp.value); });
            document.querySelectorAll('.sample-wallet-btn').forEach(b => b.addEventListener('click', () => trackWallet(b.dataset.address)));
        }, 3000);
    });
})();

function trackWallet(address) {
    if (!address || address.length < 5) return;
    const es = document.getElementById('wallet-empty-state');
    if (es) es.style.display = 'none';
    const isCrypto = address.startsWith('0x');
    const wallet = {
        address,
        name: isCrypto ? randEl(['Baleia Crypto Alpha', 'Deep Wallet', 'Cripto Gigante']) : address.replace(/-/g, ' '),
        icon: isCrypto ? '🐋' : '🏦',
        totalValue: rand(5000000, 500000000),
        pnl: rand(-15, 45),
        holdings: isCrypto
            ? state.tokens.filter(t => t.market === 'crypto').map(t => ({ symbol: t.symbol, value: rand(100000, 20000000), pct: rand(5, 40) }))
            : [
                ...state.tokens.filter(t => t.market === 'equities').slice(0, randInt(3,6)).map(t => ({ symbol: t.symbol, value: rand(5e6, 1e8), pct: rand(5, 25) })),
                { symbol: 'XAU/USD', value: rand(1e7, 5e7), pct: rand(10, 30) },
                { symbol: 'WTI', value: rand(5e6, 2e7), pct: rand(5, 15) },
                { symbol: 'Treasuries', value: rand(2e7, 1e8), pct: rand(15, 40) },
            ]
    };
    const container = document.getElementById('tracked-wallets');
    const card = document.createElement('div');
    card.className = 'wallet-card';
    const pc = wallet.pnl >= 0 ? 'positive-text' : 'negative-text';
    card.innerHTML = `
        <div class="wallet-card-header">
            <div class="wallet-identity">
                <div class="wallet-avatar">${wallet.icon}</div>
                <div><div class="wallet-name">${wallet.name}</div><div class="wallet-address">${shortAddr(wallet.address)}</div></div>
            </div>
            <div class="wallet-balance">
                <div class="wallet-total">${formatUSD(wallet.totalValue)}</div>
                <div class="wallet-pnl ${pc}">${wallet.pnl >= 0 ? '+' : ''}${wallet.pnl.toFixed(2)}% PnL</div>
            </div>
        </div>
        <div class="wallet-holdings">
            ${wallet.holdings.map(h => `<div class="holding-item"><div class="holding-symbol">${h.symbol}</div><div class="holding-value">${formatUSD(h.value)}</div><div class="holding-pct">${h.pct.toFixed(1)}%</div></div>`).join('')}
        </div>`;
    container.insertBefore(card, container.firstChild);
    document.getElementById('wallet-search-input').value = '';
    showToast('🔍', `Rastreando ${wallet.name}`, 'whale');
}

// ---- ANÁLISE DE COORTE ----
function renderCohortAnalysis() {
    const tiers = [
        { id: 'megalodon', count: randInt(50, 200), longPct: rand(55, 80) },
        { id: 'whale', count: randInt(500, 2000), longPct: rand(45, 70) },
        { id: 'dolphin', count: randInt(5000, 20000), longPct: rand(40, 65) },
        { id: 'fish', count: randInt(50000, 200000), longPct: rand(35, 60) },
        { id: 'shrimp', count: randInt(500000, 2000000), longPct: rand(30, 55) },
    ];
    tiers.forEach(t => {
        document.getElementById(t.id + '-count').textContent = t.count.toLocaleString();
        document.getElementById(t.id + '-position').textContent = t.longPct > 50 ? '📈 COMPRADO' : '📉 VENDIDO';
        document.getElementById(t.id + '-long').style.width = t.longPct + '%';
        document.getElementById(t.id + '-short').style.width = (100 - t.longPct) + '%';
        document.getElementById(t.id + '-long-pct').textContent = t.longPct.toFixed(0) + '% Comprado';
        document.getElementById(t.id + '-short-pct').textContent = (100 - t.longPct).toFixed(0) + '% Vendido';
    });
    try {
        const ctx = document.getElementById('cohort-timeline-chart');
        if (ctx && window.Chart) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: Array.from({length: 30}, (_, i) => `Dia ${i+1}`),
                    datasets: [
                        { label: 'Institucional', data: generateSparkline(30, 70, 5), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.4 },
                        { label: 'Baleia', data: generateSparkline(30, 60, 4), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.4 },
                        { label: 'Golfinho', data: generateSparkline(30, 55, 6), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4 },
                        { label: 'Peixe', data: generateSparkline(30, 50, 7), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.4 },
                        { label: 'Varejo', data: generateSparkline(30, 45, 8), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.4 },
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } } },
                    scales: {
                        x: { ticks: { color: '#64748b', maxTicksLimit: 10 }, grid: { color: 'rgba(148,163,184,0.06)' } },
                        y: { ticks: { color: '#64748b', callback: v => v + '% Long' }, grid: { color: 'rgba(148,163,184,0.06)' }, min: 20, max: 90 }
                    }
                }
            });
        }
    } catch(e) {}
}

// ---- INTELIGÊNCIA SOCIAL ----
function renderCommunityIntel() {
    const sentiments = state.posts.map(p => p.sentimentScore);
    const avg = sentiments.reduce((a,b) => a+b, 0) / sentiments.length;
    document.getElementById('stat-sentiment').textContent = avg > 0.15 ? '🟢 Otimista' : avg < -0.15 ? '🔴 Pessimista' : '🟡 Neutro';
    document.getElementById('stat-posts-count').textContent = state.posts.length.toLocaleString();
    document.getElementById('stat-trending').textContent = randEl(TOPICS);
    document.getElementById('stat-fear').textContent = state.fearGreedIndex + '/100';
    document.getElementById('sentiment-heatmap').innerHTML = state.tokens.map(t => {
        const score = rand(-1, 1);
        const bg = score > 0.3 ? 'rgba(16,185,129,0.25)' : score < -0.3 ? 'rgba(239,68,68,0.25)' : 'rgba(148,163,184,0.12)';
        const label = score > 0.3 ? 'Otimista' : score < -0.3 ? 'Pessimista' : 'Neutro';
        return `<div class="sentiment-cell" style="background:${bg}">
            <span class="sent-symbol">${t.icon || ''} ${t.symbol}</span>
            <span class="sent-score">${(score * 100).toFixed(0)}</span>
            <span class="sent-label">${label}</span>
        </div>`;
    }).join('');
    document.getElementById('word-cloud').innerHTML = TOPICS.map(topic => {
        const size = rand(0.7, 1.6);
        const colors = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#818cf8', '#34d399', '#60a5fa'];
        return `<span class="cloud-word" style="font-size:${size}rem;color:${randEl(colors)}">${topic}</span>`;
    }).join('');
    document.getElementById('community-posts').innerHTML = state.posts.map(p => `
        <div class="post-item">
            <div class="post-sentiment-indicator ${p.sentiment}"></div>
            <div class="post-info">
                <div class="post-title-text">${p.title}</div>
                <div class="post-meta">
                    <span class="post-subreddit">r/${p.subreddit}</span>
                    <span>${p.author}</span>
                    <span>${tempoAtras(Date.now() - p.time)}</span>
                    <span>💬 ${p.comments}</span>
                </div>
            </div>
            <div class="post-score"><span class="score-value">⬆ ${p.upvotes}</span><span class="${p.sentiment === 'positive' ? 'positive-text' : p.sentiment === 'negative' ? 'negative-text' : ''}">${(p.sentimentScore * 100).toFixed(0)}%</span></div>
        </div>
    `).join('');
}

// ---- FONTES DE DADOS ----
function renderDataSources() {
    document.getElementById('sources-grid').innerHTML = DATA_SOURCES.map(s => `
        <div class="source-card">
            <div class="source-card-header">
                <div class="source-icon">${s.icon}</div>
                <div>
                    <div class="source-name">${s.name}</div>
                    <div class="source-type">${s.type}</div>
                </div>
            </div>
            <div class="source-desc">${s.desc}</div>
            <div class="source-tags">${s.tags.map(t => `<span class="source-tag">${t}</span>`).join('')}</div>
            <a href="${s.url}" target="_blank" rel="noopener" class="source-link">🔗 Acessar Fonte</a>
            <div class="source-status">
                <span class="source-status-dot ${s.status}"></span>
                <span>${s.status === 'active' ? 'Integrado' : 'Planejado'}</span>
            </div>
        </div>
    `).join('');
}

// ---- CONFIGURAÇÕES ----
function setupSettings() {
    document.getElementById('save-api-keys')?.addEventListener('click', async () => {
        const keys = {
            finnhub: document.getElementById('api-finnhub')?.value || '',
            coingecko: document.getElementById('api-coingecko')?.value || '',
            etherscan: document.getElementById('api-etherscan')?.value || '',
        };
        localStorage.setItem('whalevault_api_keys', JSON.stringify(keys));
        showToast('🔄', 'Salvando chaves e conectando...', 'whale');
        // Clear cache to force fresh fetch
        LiveData.cache = {};
        LiveData.isLive = { crypto: false, stocks: false };
        const updated = await LiveData.syncAll();
        if (updated > 0) {
            showToast('✅', `Conectado! ${updated} ativos com preços reais.`, 'bull');
            updateTickers();
            renderHeatmap();
            renderMarketTable();
            renderMarketOverview();
        } else {
            showToast('⚠️', 'Verifique suas chaves de API.', 'alert');
        }
    });
    document.getElementById('clear-cache')?.addEventListener('click', () => {
        localStorage.removeItem('whalevault_cache');
        LiveData.cache = {};
        document.getElementById('cache-size').textContent = '0 KB';
        showToast('🗑️', 'Cache limpo', 'alert');
    });
    document.getElementById('export-data')?.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify({ alerts: state.alerts, tokens: state.tokens, posts: state.posts }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'monitor_baleias_export.json'; a.click();
        showToast('📥', 'Dados exportados', 'whale');
    });
    // Load saved keys
    try {
        const saved = JSON.parse(localStorage.getItem('whalevault_api_keys') || '{}');
        if (saved.finnhub) document.getElementById('api-finnhub').value = saved.finnhub;
        if (saved.coingecko) document.getElementById('api-coingecko').value = saved.coingecko;
        if (saved.etherscan) document.getElementById('api-etherscan').value = saved.etherscan;
    } catch(e) {}
    let total = 0;
    for (let key in localStorage) { if (key.startsWith('whalevault')) total += (localStorage[key] || '').length; }
    document.getElementById('cache-size').textContent = (total / 1024).toFixed(1) + ' KB';
}

// ---- TOAST ----
function showToast(icon, message, type = 'whale') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-message">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-out'); setTimeout(() => toast.remove(), 300); }, 4000);
}

// ---- ATUALIZAÇÕES AO VIVO ----
function startLiveUpdates() {
    // Whale alert simulation (continues in both live and demo mode)
    setInterval(() => {
        if (state.alertsPaused) return;
        const alert = generateWhaleAlert();
        alert.time = Date.now();
        state.alerts.unshift(alert);
        if (state.alerts.length > 100) state.alerts.pop();
        if (state.currentSection === 'whale-alerts') {
            const feed = document.getElementById('alert-feed');
            const mktLabel = {commodities:'🥇 COMMODITY', indices:'📊 ÍNDICE', equities:'📈 AÇÃO', crypto:'₿ CRYPTO'}[alert.market] || alert.market;
            const isInst = alert.market !== 'crypto';
            const div = document.createElement('div');
            div.innerHTML = `<div class="alert-item" data-chain="${alert.market}" data-impact="${alert.impact}" style="background:rgba(99,102,241,0.05)">
                <div class="alert-impact ${alert.impact}">${alert.impact === 'high' ? '🔴' : alert.impact === 'medium' ? '🟡' : '🟢'}</div>
                <div class="alert-info">
                    <div class="alert-title"><span class="amount">${formatUSD(alert.amount)}</span> ${alert.token} <span class="alert-chain-tag ${alert.market}">${mktLabel}</span></div>
                    <div class="alert-detail"><span>${alert.whaleName}</span><span class="addr">${isInst ? alert.type.toUpperCase() + ' → ' + alert.to : shortAddr(alert.from) + ' → ' + shortAddr(alert.to)}</span></div>
                </div>
                <div class="alert-meta"><div class="alert-time">agora</div><span class="alert-type-tag ${alert.type}">${alert.type}</span></div>
            </div>`;
            feed.insertBefore(div.firstElementChild, feed.firstElementChild);
        }
        document.getElementById('alert-count').textContent = state.alerts.length;
        updateAlertStats();
        if (alert.impact === 'high') showToast('🐋', `${formatUSD(alert.amount)} ${alert.token} ${alert.type} detectado!`, 'bear');
    }, randInt(5000, 12000));

    // LIVE DATA SYNC: every 60 seconds
    setInterval(async () => {
        const updated = await LiveData.syncAll();
        if (updated > 0) {
            updateTickers();
            if (state.currentSection === 'market-overview') {
                renderHeatmap();
                renderMarketOverview();
            }
            const now = new Date();
            document.getElementById('last-update').textContent = `Última atualização: ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        }
    }, 60000);

    // Small ticker animation for non-live tokens (demo mode drift)
    setInterval(() => {
        state.tokens.forEach(t => {
            if (!t._live) {
                t.price *= (1 + rand(-0.002, 0.002));
                t.change24h += rand(-0.05, 0.05);
            }
        });
        updateTickers();
        if (!LiveData.isLive.crypto && !LiveData.isLive.stocks) {
            state.fearGreedIndex = Math.max(5, Math.min(95, state.fearGreedIndex + randInt(-1, 2)));
        }
    }, 5000);
}
