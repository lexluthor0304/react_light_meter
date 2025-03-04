// App.js
import React, { useState, useRef, useEffect } from 'react';
import './App.css';

// 直接在 JSX 中返回 Document Metadata 标签
function DocumentMetadata() {
  return (
    <>
      <title>Film Camera Light Meter - Accurate Exposure Metering for Film Photography</title>
      <meta
        name="description"
        content="An advanced film camera light meter app for accurate exposure metering using manual settings, center-weighted calculations, and real-time histogram analysis."
      />
      <meta
        name="keywords"
        content="Film, Camera, Light Meter, Exposure, EV, Manual Exposure, ISO, Aperture, Shutter Speed, Histogram, Photography"
      />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta property="og:title" content="Film Camera Light Meter" />
      <meta
        property="og:description"
        content="Accurate exposure metering for film cameras using manual settings, center-weighted analysis and real-time histogram."
      />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="http://yourwebsite.com" />
      <meta property="og:image" content="http://yourwebsite.com/og-image.jpg" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Film Camera Light Meter" />
      <meta
        name="twitter:description"
        content="Accurate exposure metering for film cameras using manual settings, center-weighted analysis and real-time histogram."
      />
      <meta name="twitter:image" content="http://yourwebsite.com/twitter-image.jpg" />
      <link rel="canonical" href="http://yourwebsite.com" />
    </>
  );
}

// 预定义常用胶片相机快门速度（秒）和光圈档位
const standardShutterSpeeds = [
  1 / 1000,
  1 / 500,
  1 / 250,
  1 / 125,
  1 / 60,
  1 / 30,
  1 / 15,
  1 / 8,
  1 / 4,
  1 / 2,
  1,
];
const standardApertures = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];

// 预生成 EV 表，计算所有组合的 EV 值，并按快门速度从快到慢排序
const shutterApertureEV = standardShutterSpeeds.flatMap((s) =>
  standardApertures.map((a) => ({
    shutter: s,
    aperture: a,
    ev: Math.log2((a * a) / s),
  }))
).sort((a, b) => b.shutter - a.shutter);

/**
 * 计算视频帧中心区域的加权平均亮度。
 * 采用 sRGB → 线性转换（Gamma 校正）、Rec.709 权重，并用高斯径向权重强调中心像素。
 */
function computeCenterBrightness(video, canvas) {
  const ctx = canvas.getContext('2d');
  const { videoWidth: width, videoHeight: height } = video;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(video, 0, 0, width, height);

  // 中心区域：40%宽高
  const centerWidth = width * 0.4;
  const centerHeight = height * 0.4;
  const startX = (width - centerWidth) / 2;
  const startY = (height - centerHeight) / 2;

  const imageData = ctx.getImageData(startX, startY, centerWidth, centerHeight);
  const data = imageData.data;
  const regionCenterX = imageData.width / 2;
  const regionCenterY = imageData.height / 2;
  // 使用 sigma 为区域宽度的 1/4 加强中心权重
  const sigma = imageData.width / 4;

  let totalWeighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    const px = pixelIndex % imageData.width;
    const py = Math.floor(pixelIndex / imageData.width);
    const dx = px - regionCenterX;
    const dy = py - regionCenterY;
    const distanceSq = dx * dx + dy * dy;
    const weight = Math.exp(-distanceSq / (2 * sigma * sigma));

    // sRGB -> 线性空间（Gamma 校正，Gamma = 2.2）
    const r = Math.pow(data[i] / 255, 2.2);
    const g = Math.pow(data[i + 1] / 255, 2.2);
    const b = Math.pow(data[i + 2] / 255, 2.2);
    const luminanceLinear = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    totalWeighted += luminanceLinear * weight;
    totalWeight += weight;
  }
  const avgLinear = totalWeighted / totalWeight;
  const avgGamma = Math.pow(avgLinear, 1 / 2.2) * 255;
  return avgGamma;
}

/**
 * 曝光计算算法：基于 EV 模型。
 * 当 avgBrightness 为 118 时，假定 ISO 100 下 EV 为 15，
 * measuredEV = 15 - log₂(avgBrightness/118)
 * effectiveEV = measuredEV + 曝光补偿 + log₂(ISO/100)
 * 利用预生成 EV 表寻找最接近 effectiveEV 的快门/光圈组合，
 * 当 EV 差值相同时优先选择快门速度更快的方案（加入 epsilon 浮点比较）。
 */
function calculateExposure(avgBrightness, iso, compensation) {
  // 防止全黑导致的零值错误
  const avg = avgBrightness || 1;
  const measuredEV = 15 - Math.log2(avg / 118);
  const effectiveEV = measuredEV + compensation + Math.log2(iso / 100);

  let bestCandidate = shutterApertureEV[0];
  let bestDiff = Math.abs(bestCandidate.ev - effectiveEV);
  const epsilon = 1e-6;
  for (const candidate of shutterApertureEV) {
    const diff = Math.abs(candidate.ev - effectiveEV);
    if (
      diff < bestDiff - epsilon ||
      (Math.abs(diff - bestDiff) < epsilon && candidate.shutter > bestCandidate.shutter)
    ) {
      bestDiff = diff;
      bestCandidate = candidate;
    }
  }
  return { shutterSpeed: bestCandidate.shutter, aperture: bestCandidate.aperture, effectiveEV };
}

/**
 * 计算并绘制直方图：
 * 1. 利用临时 canvas 获取视频帧数据；
 * 2. 每隔两个像素采样一次，计算每个像素的亮度（采用 Rec.601 权重），并根据曝光补偿调整亮度；
 * 3. 使用 requestAnimationFrame 优化直方图绘制，处理全黑场景防止除零错误。
 */
function drawHistogram(video, canvas, compensation) {
  const ctx = canvas.getContext('2d');
  const frameWidth = video.videoWidth;
  const frameHeight = video.videoHeight;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = frameWidth;
  tempCanvas.height = frameHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(video, 0, 0, frameWidth, frameHeight);
  const imageData = tempCtx.getImageData(0, 0, frameWidth, frameHeight);
  const data = imageData.data;

  const histogram = new Array(256).fill(0);
  // 遍历每个像素，每隔两个像素采样一次
  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    if (pixelIndex % 2 === 0) {
      const brightness = Math.floor(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      const adjustedBrightness = Math.min(Math.floor(brightness * Math.pow(2, compensation)), 255);
      histogram[adjustedBrightness]++;
    }
  }

  const canvasWidth = (canvas.width = frameWidth);
  const canvasHeight = (canvas.height = 100);
  const maxCount = Math.max(...histogram) || 1;
  const binWidth = canvasWidth / 256;

  requestAnimationFrame(() => {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    for (let i = 0; i < 256; i++) {
      const binHeight = (histogram[i] / maxCount) * canvasHeight;
      ctx.fillStyle = '#39FF14';
      ctx.fillRect(i * binWidth, canvasHeight - binHeight, binWidth, binHeight);
    }
  });
}

function App() {
  const [step, setStep] = useState('permission'); // 'permission', 'iso', 'meter'
  const [stream, setStream] = useState(null);
  const [iso, setIso] = useState(100);
  const [compensation, setCompensation] = useState(0);
  const [exposure, setExposure] = useState({ shutterSpeed: 0, aperture: 0, effectiveEV: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const histCanvasRef = useRef(null);
  const intervalRef = useRef(null);

  // 请求摄像头权限并尝试禁用自动曝光
  const requestCamera = async () => {
    setIsLoading(true);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          advanced: [{ exposureMode: 'manual' }],
        },
        audio: false,
      });
      const videoTrack = mediaStream.getVideoTracks()[0];
      const capabilities = videoTrack.getCapabilities();
      if (capabilities.exposureMode) {
        if (!capabilities.exposureMode.includes('manual')) {
          alert('Your device does not support manual exposure. Results may be inaccurate.');
        } else {
          await videoTrack.applyConstraints({ advanced: [{ exposureMode: 'manual' }] });
        }
      }
      setStream(mediaStream);
      setStep('iso');
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Unable to access camera. Please check your permissions.');
    } finally {
      setIsLoading(false);
    }
  };

  // 当进入测光界面时启动摄像头预览，每秒计算曝光并更新直方图
  useEffect(() => {
    if (step === 'meter' && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      intervalRef.current = setInterval(() => {
        if (videoRef.current && canvasRef.current && histCanvasRef.current) {
          const avgBrightness = computeCenterBrightness(videoRef.current, canvasRef.current);
          const exp = calculateExposure(avgBrightness, iso, compensation);
          setExposure(exp);
          drawHistogram(videoRef.current, histCanvasRef.current, compensation);
        }
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [step, stream, iso, compensation]);

  // 组件卸载时停止摄像头流，防止资源泄漏
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  // Step 1: 请求摄像头权限
  if (step === 'permission') {
    return (
      <div className="container">
        <DocumentMetadata />
        <h1 className="title">Film Camera Light Meter</h1>
        <p className="message">Please allow access to your camera to start.</p>
        <button onClick={requestCamera} className="btn" disabled={isLoading}>
          {isLoading ? 'Connecting...' : 'Allow Camera Access'}
        </button>
      </div>
    );
  }

  // Step 2: 选择 ISO 和曝光补偿
  if (step === 'iso') {
    return (
      <div className="container">
        <DocumentMetadata />
        <h1 className="title">Set ISO and Exposure Compensation</h1>
        <div className="input-group">
          <label>
            ISO:
            <select
              value={iso}
              onChange={(e) => setIso(parseInt(e.target.value))}
              className="select"
            >
              <option value="100">ISO 100</option>
              <option value="200">ISO 200</option>
              <option value="400">ISO 400</option>
              <option value="800">ISO 800</option>
              <option value="1600">ISO 1600</option>
            </select>
          </label>
        </div>
        <div className="input-group">
          <label>
            Exposure Compensation:
            <select
              value={compensation}
              onChange={(e) => setCompensation(parseFloat(e.target.value))}
              className="select"
            >
              <option value="-3">-3 EV</option>
              <option value="-2">-2 EV</option>
              <option value="-1">-1 EV</option>
              <option value="0">0 EV</option>
              <option value="1">+1 EV</option>
              <option value="2">+2 EV</option>
              <option value="3">+3 EV</option>
            </select>
          </label>
        </div>
        <button onClick={() => setStep('meter')} className="btn">
          Confirm
        </button>
      </div>
    );
  }

  // Step 3: 测光页面 – 显示摄像头预览、曝光设置、直方图与当前 EV
  if (step === 'meter') {
    return (
      <div className="meter-container">
        <DocumentMetadata />
        <header className="meter-header">
          <button onClick={() => setStep('iso')} className="btn small">
            Back
          </button>
          <h1 className="header-title">Measuring Exposure</h1>
          <div></div>
        </header>
        <main className="meter-main">
          <video ref={videoRef} className="video-preview" playsInline muted />
          {/* 隐藏 canvas 用于测光计算 */}
          <canvas ref={canvasRef} className="hidden-canvas" />
          {/* 曝光信息显示 */}
          <div className="exposure-info">
            <p>
              Recommended Shutter Speed:{' '}
              {exposure.shutterSpeed > 0 && exposure.shutterSpeed < 1
                ? `1/${Math.round(1 / exposure.shutterSpeed)} sec`
                : `${exposure.shutterSpeed.toFixed(1).replace(/\.0$/, '')} sec`}
            </p>
            <p>
              Recommended Aperture:{' '}
              {exposure.aperture
                ? `f/${
                    exposure.aperture % 1 === 0
                      ? exposure.aperture.toFixed(0)
                      : exposure.aperture.toFixed(1)
                  }`
                : '--'}
            </p>
            <p>Current EV: {exposure.effectiveEV.toFixed(1)}</p>
            <p className="note">
              (Using center-weighted metering, ISO = {iso}, EV Compensation = {compensation})
            </p>
          </div>
          {/* 直方图显示 */}
          <canvas ref={histCanvasRef} className="histogram-canvas" />
        </main>
      </div>
    );
  }

  return null;
}

// 错误边界组件，用于捕获运行时错误
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <div className="error">Measurement system error</div>;
    }
    return this.props.children;
  }
}

// 包裹 App 组件
export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}