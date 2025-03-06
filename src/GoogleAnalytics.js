import { useEffect } from "react";

const GoogleAnalytics = ({ trackingId }) => {
  useEffect(() => {
    // 检查是否已加载 GA4，避免重复加载
    if (!document.querySelector(`script[src="https://www.googletagmanager.com/gtag/js?id=${trackingId}"]`)) {
      // 加载 GA4 主脚本
      const script = document.createElement("script");
      script.src = `https://www.googletagmanager.com/gtag/js?id=${trackingId}`;
      script.async = true;
      document.head.appendChild(script);

      // 加载 GA4 配置
      const inlineScript = document.createElement("script");
      inlineScript.innerHTML = `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${trackingId}');
      `;
      document.head.appendChild(inlineScript);
    }
  }, [trackingId]);

  return null; // 不需要返回 JSX，因为脚本是动态添加的
};

export default GoogleAnalytics;