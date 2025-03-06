import { SitemapStream, streamToPromise } from "sitemap";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 兼容 ESM（Node.js 20+）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN = "https://lightmeter.tokugai.com"; // 替换成你的域名

const pages = [
  "/"
];

async function generateSitemap() {
  const sitemap = new SitemapStream({ hostname: DOMAIN });

  pages.forEach((url) => {
    sitemap.write({ url, changefreq: "daily", priority: 0.8 });
  });

  sitemap.end();

  try {
    const xmlData = await streamToPromise(sitemap).then((sm) => sm.toString());

    // 确保 public 目录存在
    const publicPath = path.join(__dirname, "../public");
    if (!existsSync(publicPath)) {
      mkdirSync(publicPath, { recursive: true });
      console.log("📁 Created directory:", publicPath);
    }

    // 生成 public/sitemap.xml
    const sitemapPath = path.join(publicPath, "sitemap.xml");
    writeFileSync(sitemapPath, xmlData, "utf8");
    console.log("✅ Sitemap successfully generated at:", sitemapPath);
  } catch (err) {
    console.error("❌ Error generating sitemap:", err);
  }
}

generateSitemap();