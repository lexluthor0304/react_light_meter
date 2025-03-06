// App.js
import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import GoogleTag from "./GoogleTag";
import GoogleAnalytics from "./GoogleAnalytics";

// 预先创建临时 canvas，用于直方图绘制，避免频繁创建销毁
const tempCanvas = document.createElement('canvas');

/**
 * DocumentMetadata – 页面 Meta 标签（已增加 format-detection 和 tap-highlight 支持移动端防误触）
 */
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
      {/* 苹果设备及移动端优化 */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="format-detection" content="telephone=no, email=no, address=no" />
      <meta name="msapplication-tap-highlight" content="no" />
    </>
  );
}

// 快门速度上限调整为 1/1000 秒，更符合胶片相机（如徕卡M6）的实际情况
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

// 预生成 EV 表（基础数据）
// EV 计算公式：log₂((光圈²) / 快门速度)
const shutterApertureEV = standardShutterSpeeds.flatMap((s) =>
  standardApertures.map((a) => ({
    shutter: s,
    aperture: a,
    ev: Math.log2((a * a) / s),
  }))
);

// 虽然下列排序在新版中不直接使用，但依然保留作为参考
//const shutterPriorityEV = shutterApertureEV
//  .map((candidate) => ({
//    ...candidate,
//    ev: Math.log2(candidate.aperture ** 2 / candidate.shutter),
//  }))
//  .sort((a, b) => a.shutter - b.shutter || a.aperture - b.aperture);

//const aperturePriorityEV = shutterApertureEV
//  .map((candidate) => ({
//    ...candidate,
//    ev: Math.log2(candidate.aperture ** 2 / candidate.shutter),
//  }))
//  .sort((a, b) => a.aperture - b.aperture || a.shutter - b.shutter);

// 定义18%灰卡对应的反射值（ANSI标准），用于 EV 计算说明
const referenceGray = 118;
const referenceEV = 12.7; // 基准 EV 值

/**
 * 计算视频帧中心区域的加权平均亮度
 * 根据测光模式不同，选取区域：
 *  - center：中心权重，使用中央20%区域（高斯加权）
 *  - spot：点测光，使用中央5%区域（均匀采样）
 */
function computeBrightness(video, canvas, meteringMode) {
  if (video.readyState !== 4 || video.paused) return 0;
  const ctx = canvas.getContext('2d');
  const { videoWidth: width, videoHeight: height } = video;
  if (width === 0 || height === 0) return 0;
  // 降采样到最多 640x480
  const downscaleWidth = Math.min(640, width);
  const downscaleHeight = Math.min(480, height);
  canvas.width = downscaleWidth;
  canvas.height = downscaleHeight;
  ctx.clearRect(0, 0, downscaleWidth, downscaleHeight);
  ctx.drawImage(video, 0, 0, downscaleWidth, downscaleHeight);

  let regionWidth, regionHeight;
  if (meteringMode === 'spot') {
    // 点测光：采样更小区域，改为 5%
    regionWidth = downscaleWidth * 0.05;
    regionHeight = downscaleHeight * 0.05;
  } else {
    // 中心权重测光：中央 20% 区域
    regionWidth = downscaleWidth * 0.2;
    regionHeight = downscaleHeight * 0.2;
  }
  const startX = (downscaleWidth - regionWidth) / 2;
  const startY = (downscaleHeight - regionHeight) / 2;
  const imageData = ctx.getImageData(startX, startY, regionWidth, regionHeight);
  const data = imageData.data;

  let total = 0, count = 0;
  if (meteringMode === 'spot') {
    // 点测光：直接平均（无权重）
    for (let i = 0; i < data.length; i += 4) {
      const r = Math.pow(data[i] / 255, 2.2);
      const g = Math.pow(data[i + 1] / 255, 2.2);
      const b = Math.pow(data[i + 2] / 255, 2.2);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      total += luminance;
      count++;
    }
  } else {
    // 中心权重：采用高斯加权，中心基于采样区域的尺寸
    const regionCenterX = regionWidth / 2;
    const regionCenterY = regionHeight / 2;
    const sigma = regionWidth / 4;
    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      const px = pixelIndex % imageData.width;
      const py = Math.floor(pixelIndex / imageData.width);
      const dx = px - regionCenterX;
      const dy = py - regionCenterY;
      const weight = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      const r = Math.pow(data[i] / 255, 2.2);
      const g = Math.pow(data[i + 1] / 255, 2.2);
      const b = Math.pow(data[i + 2] / 255, 2.2);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      total += luminance * weight;
      count += weight;
    }
  }
  const avgLinear = count ? total / count : 0;
  const avgGamma = Math.pow(avgLinear, 1 / 2.2) * 255;
  return avgGamma;
}

/**
 * 计算 EV
 * 公式说明：measuredEV = referenceEV + log₂((avgBrightness * calibrationFactor)/referenceGray) + log₂(ISO/100)
 * 其中 referenceGray（118）为 18% 灰卡反射值（ANSI标准）
 */
function calculateEffectiveEV(avgBrightness, iso, compensation, calibrationFactor = 1.0) {
  if (avgBrightness <= 0) return -Infinity;
  const measuredEV =
    referenceEV +
    Math.log2((avgBrightness * calibrationFactor) / referenceGray) +
    Math.log2(iso / 100);
  return measuredEV + compensation;
}

/**
 * 快门优先曝光计算（用户已选择快门速度）
 * 仅在候选组合中筛选出快门速度为 chosenShutter 的组合，再选择 EV 最接近的那个
 */
function calculateExposureShutterPriority(avgBrightness, iso, compensation, chosenShutter, calibrationFactor = 1.0) {
  const effectiveEV = calculateEffectiveEV(avgBrightness, iso, compensation, calibrationFactor);
  const candidates = shutterApertureEV.filter(c => c.shutter === chosenShutter);
  let closestCandidate = null;
  let minDiff = Infinity;
  candidates.forEach(candidate => {
    const diff = Math.abs(candidate.ev - effectiveEV);
    if (diff < minDiff) {
      minDiff = diff;
      closestCandidate = candidate;
    }
  });
  const evDifference = closestCandidate ? closestCandidate.ev - effectiveEV : 0;
  return {
    shutterSpeed: chosenShutter,
    aperture: closestCandidate ? closestCandidate.aperture : 0,
    effectiveEV,
    evDifference,
  };
}

/**
 * 光圈优先曝光计算（用户已选择光圈）
 * 仅在候选组合中筛选出光圈为 chosenAperture 的组合，再选择 EV 最接近的那个
 */
function calculateExposureAperturePriority(avgBrightness, iso, compensation, chosenAperture, calibrationFactor = 1.0) {
  const effectiveEV = calculateEffectiveEV(avgBrightness, iso, compensation, calibrationFactor);
  const candidates = shutterApertureEV.filter(c => c.aperture === chosenAperture);
  let closestCandidate = null;
  let minDiff = Infinity;
  candidates.forEach(candidate => {
    const diff = Math.abs(candidate.ev - effectiveEV);
    if (diff < minDiff) {
      minDiff = diff;
      closestCandidate = candidate;
    }
  });
  const evDifference = closestCandidate ? closestCandidate.ev - effectiveEV : 0;
  return {
    shutterSpeed: closestCandidate ? closestCandidate.shutter : 0,
    aperture: chosenAperture,
    effectiveEV,
    evDifference,
  };
}

/**
 * 根据优先模式选择曝光计算逻辑
 * 此函数根据传入的 chosenValue（光圈或快门）调用对应的计算函数

function calculateExposure(avgBrightness, iso, compensation, priorityMode, chosenValue, calibrationFactor = 1.0) {
  if (priorityMode === 'shutter') {
    return calculateExposureShutterPriority(avgBrightness, iso, compensation, chosenValue, calibrationFactor);
  } else {
    return calculateExposureAperturePriority(avgBrightness, iso, compensation, chosenValue, calibrationFactor);
  }
}
 */

/**
 * 绘制直方图：对降采样视频帧绘制直方图，
 * 替换颜色逻辑：超过245部分显示红色（过曝），低于15显示蓝色（欠曝），其余显示绿色。
 * 此处采用预先创建的 tempCanvas 避免频繁创建。
 */
function drawHistogram(video, canvas, compensation) {
  if (video.readyState !== 4 || video.paused) return;
  const downscaleWidth = Math.min(640, video.videoWidth);
  const downscaleHeight = Math.min(480, video.videoHeight);
  const ctx = canvas.getContext('2d');
  tempCanvas.width = downscaleWidth;
  tempCanvas.height = downscaleHeight;
  const tempCtx = tempCanvas.getContext('2d');
  try {
    tempCtx.drawImage(video, 0, 0, downscaleWidth, downscaleHeight);
  } catch (err) {
    console.error('drawImage error:', err);
    return;
  }
  const imageData = tempCtx.getImageData(0, 0, downscaleWidth, downscaleHeight);
  const data = imageData.data;
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    if (pixelIndex % 2 === 0) {
      const brightness = Math.floor(
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      );
      const adjusted = brightness * Math.pow(2, compensation);
      const adjustedBrightness = Math.min(Math.round(adjusted), 255);
      histogram[adjustedBrightness]++;
    }
  }
  // 新直方图尺寸：宽 512，高 200
  const histWidth = 320;
  const histHeight = 150;
  canvas.width = histWidth;
  canvas.height = histHeight;
  const maxCount = Math.max(...histogram) || 1;
  const scaleX = histWidth / 256; // 每个直方图 bin 的宽度缩放因子
  requestAnimationFrame(() => {
    ctx.clearRect(0, 0, histWidth, histHeight);
    for (let i = 0; i < 256; i++) {
      const binHeight = (histogram[i] / maxCount) * histHeight;
      ctx.fillStyle = i > 245 ? 'red' : i < 15 ? 'blue' : 'green';
      ctx.fillRect(i * scaleX, histHeight - binHeight, scaleX, binHeight);
    }
    // 标注 Zone III 到 Zone VII
    ctx.save();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.font = '14px sans-serif'; // 调大字体便于阅读
    const zones = [3, 4, 5, 6, 7];
    zones.forEach(zone => {
      // 根据 Zone System 计算对应亮度值
      const brightnessForZone = referenceGray * Math.pow(2, zone - 5);
      // 乘以缩放因子转换到新坐标系
      let x = brightnessForZone * scaleX;
      if (x > histWidth) x = histWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, histHeight);
      ctx.stroke();
      // 计算文本宽度，调整位置确保显示完全
      const text = `Z${zone}`;
      const textWidth = ctx.measureText(text).width;
      let textX = x + 2;
      if (textX + textWidth > histWidth) {
        textX = x - textWidth - 2;
      }
      ctx.fillText(text, textX, 20);
    });
    ctx.restore();
  });
}

/**
 * 根据 EV 值返回场景描述，帮助用户理解曝光情况
 */
function getSceneDescription(effectiveEV) {
  if (effectiveEV >= 15) return 'Bright outdoor (Sunny)';
  else if (effectiveEV >= 12) return 'Outdoor overcast / bright indoor';
  else if (effectiveEV >= 9) return 'Indoor (normal lighting)';
  else if (effectiveEV >= 7) return 'Dim indoor / night street';
  else return 'Very low light';
}

function App() {
  // 步骤状态：'permission'、'iso'、'meter'
  const [step, setStep] = useState('permission');
  const [stream, setStream] = useState(null);
  // 扩展 ISO 选项
  const [iso, setIso] = useState(100);
  const [compensation, setCompensation] = useState(0);
  const [priorityMode, setPriorityMode] = useState('shutter'); // 'shutter' 或 'aperture'
  // 新增：用户固定的光圈或快门参数
  const [chosenAperture, setChosenAperture] = useState(2.8); // 默认光圈 f/2.8
  const [chosenShutter, setChosenShutter] = useState(1/125); // 默认快门 1/125 sec
  // 校准因子固定为1.0（基于标准18%灰卡假设）
  const [calibrationFactor] = useState(1.0);
  // 测光模式：'center'（中央20%，高斯加权）或 'spot'（点测光：中央5%）
  const [meteringMode, setMeteringMode] = useState('center');
  const [exposure, setExposure] = useState({ shutterSpeed: 0, aperture: 0, effectiveEV: 0, smoothedEV: 0, evDifference: 0 });
  const [exposureWarning, setExposureWarning] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const histCanvasRef = useRef(null);
  // 用于 EV 平滑滤波（仅用于 UI 展示）
  const smoothedEVRef = useRef(null);

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
      try {
        if (capabilities.exposureMode && capabilities.exposureMode.includes('manual')) {
          await videoTrack.applyConstraints({ advanced: [{ exposureMode: 'manual' }] });
        } else {
          console.warn('Manual exposure mode not supported.');
        }
      } catch (err) {
        console.error('Exposure constraint error:', err);
      }
      setStream(mediaStream);
      // 直接进入 ISO 设置环节
      setStep('iso');
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Unable to access camera. Please check your permissions.');
    } finally {
      setIsLoading(false);
    }
  };

  // 存储设置到 localStorage（ISO、曝光补偿和优先模式）
  useEffect(() => {
    localStorage.setItem('iso', iso);
    localStorage.setItem('compensation', compensation);
    localStorage.setItem('priorityMode', priorityMode);
  }, [iso, compensation, priorityMode]);

  // 启动时恢复设置
  useEffect(() => {
    const storedIso = parseInt(localStorage.getItem('iso'), 10);
    if (!isNaN(storedIso)) setIso(storedIso);
    const storedCompensation = parseFloat(localStorage.getItem('compensation'));
    if (!isNaN(storedCompensation)) setCompensation(storedCompensation);
    const storedPriority = localStorage.getItem('priorityMode');
    if (storedPriority) setPriorityMode(storedPriority);
  }, []);

  // 摄像头预览及周期性测光
  useEffect(() => {
    if (step === 'meter' && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      const intervalId = setInterval(() => {
        try {
          if (
            videoRef.current &&
            canvasRef.current &&
            histCanvasRef.current &&
            videoRef.current.videoWidth > 0 &&
            videoRef.current.videoHeight > 0 &&
            videoRef.current.readyState === 4 &&
            !videoRef.current.paused
          ) {
            const avgBrightness = computeBrightness(
              videoRef.current,
              canvasRef.current,
              meteringMode
            );
            // 异常场景处理
            if (avgBrightness < 5) {
              setError('Scene too dark: Use manual adjustments or increase ISO.');
            } else if (avgBrightness > 250) {
              setError('Scene too bright: Consider reducing ISO or adjusting aperture.');
            } else {
              setError('');
              // 根据优先模式调用对应的曝光计算函数
              let exp;
              if (priorityMode === 'aperture') {
                exp = calculateExposureAperturePriority(avgBrightness, iso, compensation, chosenAperture, calibrationFactor);
              } else {
                exp = calculateExposureShutterPriority(avgBrightness, iso, compensation, chosenShutter, calibrationFactor);
              }
              // EV 平滑滤波（仅用于 UI 显示）
              let currentEV = exp.effectiveEV;
              if (smoothedEVRef.current === null) {
                smoothedEVRef.current = currentEV;
              } else {
                const smoothingFactor = 0.3;
                smoothedEVRef.current =
                  smoothedEVRef.current * (1 - smoothingFactor) + currentEV * smoothingFactor;
              }
              exp.smoothedEV = smoothedEVRef.current;
              setExposure(exp);
              // 边界检查：若推荐曝光与测光 EV 差值大于 1 EV，给出警告
              if (Math.abs(exp.evDifference) > 1) {
                setExposureWarning('Exposure out of range! Consider adjusting aperture or ISO.');
              } else {
                setExposureWarning('');
              }
            }
            drawHistogram(videoRef.current, histCanvasRef.current, compensation);
          }
        } catch (e) {
          console.error(e);
          setError('Measurement error');
        }
      }, 500);
      return () => clearInterval(intervalId);
    }
  }, [step, stream, iso, compensation, priorityMode, calibrationFactor, meteringMode, chosenAperture, chosenShutter]);

  // 组件卸载时停止摄像头流
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

  // Step 2: 选择 ISO、曝光补偿、优先模式及固定的光圈/快门值，同时选择测光模式
  if (step === 'iso') {
    return (
      <div className="container">
        <DocumentMetadata />
        <h1 className="title">Set ISO, Exposure Compensation, Priority &amp; Metering Mode</h1>
        <p className="note">Note: Light metering is based on the assumption of a standard 18% gray card (calibration factor = 1.0).</p>
        <div className="input-group">
          <label>
            ISO:
            <select value={iso} onChange={(e) => setIso(parseInt(e.target.value))} className="select">
              <option value="64">ISO 64</option>
              <option value="100">ISO 100</option>
              <option value="125">ISO 125</option>
              <option value="160">ISO 160</option>
              <option value="200">ISO 200</option>
              <option value="250">ISO 250</option>
              <option value="320">ISO 320</option>
              <option value="400">ISO 400</option>
              <option value="500">ISO 500</option>
              <option value="800">ISO 800</option>
              <option value="1000">ISO 1000</option>
              <option value="1600">ISO 1600</option>
              <option value="3200">ISO 3200</option>
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
        <div className="input-group">
          <label>
            Priority Mode:
            <select
              value={priorityMode}
              onChange={(e) => setPriorityMode(e.target.value)}
              className="select"
            >
              <option value="shutter">Shutter Priority</option>
              <option value="aperture">Aperture Priority</option>
            </select>
          </label>
        </div>
        {priorityMode === 'aperture' && (
          <div className="input-group">
            <label>
              Chosen Aperture:
              <select value={chosenAperture} onChange={(e) => setChosenAperture(parseFloat(e.target.value))} className="select">
                <option value={1.4}>f/1.4</option>
                <option value={2}>f/2</option>
                <option value={2.8}>f/2.8</option>
                <option value={4}>f/4</option>
                <option value={5.6}>f/5.6</option>
                <option value={8}>f/8</option>
                <option value={11}>f/11</option>
                <option value={16}>f/16</option>
              </select>
            </label>
          </div>
        )}
        {priorityMode === 'shutter' && (
          <div className="input-group">
            <label>
              Chosen Shutter:
              <select value={chosenShutter} onChange={(e) => setChosenShutter(parseFloat(e.target.value))} className="select">
                <option value={1/1000}>1/1000 sec</option>
                <option value={1/500}>1/500 sec</option>
                <option value={1/250}>1/250 sec</option>
                <option value={1/125}>1/125 sec</option>
                <option value={1/60}>1/60 sec</option>
                <option value={1/30}>1/30 sec</option>
                <option value={1/15}>1/15 sec</option>
                <option value={1/8}>1/8 sec</option>
              </select>
            </label>
          </div>
        )}
        <div className="input-group">
          <label>
            Metering Mode:
            <select
              value={meteringMode}
              onChange={(e) => setMeteringMode(e.target.value)}
              className="select"
            >
              <option value="center">Center Weighted (Central 20%, Gaussian Weighting)</option>
              <option value="spot">Spot Meter (Central 5% area)</option>
            </select>
          </label>
        </div>
        <button onClick={() => setStep('meter')} className="btn">
          Confirm &amp; Start Metering
        </button>
      </div>
    );
  }

  // Step 3: 测光页面 – 显示摄像头预览、曝光信息、直方图及场景描述
  if (step === 'meter') {
    const evDifference = Math.abs(exposure.smoothedEV - exposure.effectiveEV);
    let exposureWarningColor = 'green';
    if (evDifference >= 2) {
      exposureWarningColor = 'red';
    } else if (evDifference >= 1) {
      exposureWarningColor = 'orange';
    }
    return (
      <>
        <GoogleAnalytics trackingId="G-1ZZ5X14QXX" />
        <GoogleTag trackingId="G-1ZZ5X14QXX" />
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
            <canvas ref={histCanvasRef} className="histogram-canvas" />
            <canvas ref={canvasRef} className="hidden-canvas" />
            <div className="exposure-info">
              {error ? (
                <p className="error-message">{error}</p>
              ) : (
                <>
                  <p>
                    {priorityMode === 'shutter'
                      ? `Chosen Shutter: ${exposure.shutterSpeed > 0 && exposure.shutterSpeed < 1 ? `1/${Math.round(1 / exposure.shutterSpeed)} sec` : `${exposure.shutterSpeed.toFixed(1).replace(/\.0$/, '')} sec`}`
                      : `Chosen Aperture: f/${exposure.aperture}`}
                  </p>
                  <p>
                    Recommended {priorityMode === 'shutter' ? 'Aperture' : 'Shutter Speed'}:{" "}
                    {priorityMode === 'shutter'
                      ? (exposure.aperture ? `f/${exposure.aperture % 1 === 0 ? exposure.aperture.toFixed(0) : exposure.aperture.toFixed(1)}` : '--')
                      : (exposure.shutterSpeed > 0 && exposure.shutterSpeed < 1
                          ? `1/${Math.round(1 / exposure.shutterSpeed)} sec`
                          : `${exposure.shutterSpeed.toFixed(1).replace(/\.0$/, '')} sec`)}
                  </p>
                  <p style={{ color: exposureWarningColor }}>
                    Current EV: {Number.isFinite(exposure.smoothedEV)
                      ? exposure.smoothedEV.toFixed(1)
                      : 'N/A'}
                  </p>
                  <p>
                    Scene: {getSceneDescription(exposure.smoothedEV)}
                  </p>
                  <p className="note">
                    (Using {meteringMode === 'center'
                      ? 'center-weighted (Central 20%, Gaussian Weighting)'
                      : 'spot (Central 5% area)'}{' '}
                    metering, ISO = {iso}, EV Compensation = {compensation}, Priority Mode = {priorityMode}, Calibration Factor = 1.0)
                  </p>
                  <p className="note">
                    EV formula: EV = {referenceEV} + log₂((Brightness × 1.0)/{referenceGray}) + log₂(ISO/100)
                  </p>
                  <p>
                    Exposure difference: {Math.abs(exposure.evDifference).toFixed(1)} EV
                  </p>
                  {exposureWarning && <p className="warning">{exposureWarning}</p>}
                </>
              )}
            </div>
          </main>
        </div>
      </>
    );
  }
  return null;
}

// 错误边界组件
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

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}