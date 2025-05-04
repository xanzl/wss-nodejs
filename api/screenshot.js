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

// 限流中间件（每分钟30次）
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  handler: (req, res) => {
    res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.status(200).send('Screenshot Service Ready');
});

// 参数验证规则
const schema = Joi.object({
  url: Joi.string().uri().required().messages({
    'string.uri': 'URL格式无效',
    'any.required': '必须提供URL参数'
  }),
  format: Joi.string().valid('jpeg', 'png').default('jpeg'),
  width: Joi.number().min(100).max(MAX_DIMENSION).default(DEFAULT_WIDTH),
  height: Joi.number().min(100).max(MAX_DIMENSION).default(DEFAULT_HEIGHT),
  full_page: Joi.boolean().default(false),
  referer: Joi.string().uri().optional()
});

// 浏览器启动配置
const browserConfig = {
  headless: true,
  args: [
    '--disable-gpu',
    '--single-process',
    '--no-sandbox',
    '--disable-dev-shm-usage'
  ]
};

// 中间件设置
app.use(express.json()); // 解析JSON请求体
app.use(limiter);       // 应用限流

// 健康检查端点
app.get('/', (req, res) => {
  res.status(200).send('Screenshot Service Ready');
});

// 统一请求处理函数
async function handleRequest(params, res) {
  let browser = null;
  try {
    // 参数验证
    const { error, value } = schema.validate(params);
    if (error) {
      return res.status(400).json({ 
        error: '参数校验失败',
        details: error.details.map(d => d.message)
      });
    }

    // 启动浏览器
    browser = await chromium.launch(browserConfig);
    const page = await browser.newPage();

    // 设置视口和请求头
    await page.setViewportSize({ 
      width: value.width, 
      height: value.height 
    });
    
    const headers = {
      'User-Agent': DESKTOP_UA,
      'Referer': value.referer || value.url
    };
    await page.setExtraHTTPHeaders(headers);

    // 导航到目标页面
    await page.goto(value.url, {
      waitUntil: 'networkidle',
      timeout: 20000
    });
    await page.waitForTimeout(1000); // 额外等待1秒

    // 截图配置
    const options = {
      type: value.format,
      quality: value.format === 'jpeg' ? 90 : undefined,
      fullPage: value.full_page
    };

    // 执行截图
    const buffer = await page.screenshot(options);
    
    // 返回图片响应
    res
      .status(200)
      .set({
        'Content-Type': `image/${value.format}`,
        'Cache-Control': 'public, max-age=86400, s-maxage=3600'
      })
      .send(buffer);

  } catch (error) {
    console.error('截图处理失败:', error);
    res.status(500).json({ 
      error: '服务器内部错误',
      message: error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
}

// GET请求处理
app.get('/', async (req, res) => {
  await handleRequest(req.query, res);
});

// POST请求处理
app.post('/', async (req, res) => {
  await handleRequest(req.body, res);
});

export default app;