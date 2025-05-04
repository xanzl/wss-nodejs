// api/screenshot.js
import express from 'express';
import Joi from 'joi';
import { chromium } from 'playwright';
import rateLimit from 'express-rate-limit';

const app = express();

// 配置常量
const MAX_DIMENSION = 2000;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 限流配置
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 30,
  handler: (req, res) => {
    res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
});

// 参数验证schema
const schema = Joi.object({
  url: Joi.string().uri().required(),
  format: Joi.string().valid('jpeg', 'png').default('jpeg'),
  width: Joi.number().min(100).max(MAX_DIMENSION).default(DEFAULT_WIDTH),
  height: Joi.number().min(100).max(MAX_DIMENSION).default(DEFAULT_HEIGHT),
  full_page: Joi.boolean().default(false),
  referer: Joi.string().uri().optional()
});

// 截图处理函数
async function takeScreenshot(params) {
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--single-process',
        '--no-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    await page.setViewportSize({ width: params.width, height: params.height });
    
    const headers = {
      'User-Agent': DESKTOP_UA,
      'Referer': params.referer || params.url
    };
    await page.setExtraHTTPHeaders(headers);

    await page.goto(params.url, {
      waitUntil: 'networkidle',
      timeout: 20000
    });
    await page.waitForTimeout(1000);

    const options = {
      type: params.format,
      quality: params.format === 'jpeg' ? 90 : undefined,
      fullPage: params.full_page
    };

    const buffer = await page.screenshot(options);
    return {
      status: 200,
      headers: {
        'Content-Type': `image/${params.format}`,
        'Cache-Control': 'public, max-age=86400, s-maxage=3600'
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('截图失败:', error);
    return {
      status: 500,
      body: JSON.stringify({ error: `截图失败: ${error.message}` })
    };
  } finally {
    if (browser) await browser.close();
  }
}

// 中间件
app.use(express.json());
app.use(limiter);

// 路由处理
app.get('/', async (req, res) => {
  try {
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.details });

    const result = await takeScreenshot(value);
    res.status(result.status)
      .set(result.headers)
      .send(result.body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/', async (req, res) => {
  try {
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details });

    const result = await takeScreenshot(value);
    res.status(result.status)
      .set(result.headers)
      .send(result.body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;