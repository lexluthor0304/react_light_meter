// App.js
import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import GoogleTag from "./GoogleTag.js";
import GoogleAnalytics from "./GoogleAnalytics.js";

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

// 定义18%灰卡对应的反射值（调整为更接近数码设备标准）和基准 EV 值
const referenceGray = 128;
const referenceEV = 6; // 基准 EV 值

/**
 * 计算视频帧中心区域的平均亮度
 * 采用直接感知亮度计算（基于 sRGB 标准，无 Gamma 转换）
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
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 直接计算感知亮度（基于 sRGB 推荐公式，无 Gamma 变换）
    // const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    total += luminance;
    count++;
  }
  return count ? total / count : 0;
}

/**
 * 计算 EV
 * 公式说明：measuredEV = referenceEV + log₂((avgBrightness × calibrationFactor)/referenceGray) + log₂(ISO/100)
 * calibrationFactor 为内部校准系数，不对用户暴露
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
 * 绘制直方图：对降采样视频帧绘制直方图，
 * 替换颜色逻辑：超过245部分显示红色（过曝），低于15显示蓝色（欠曝），其余显示绿色。
 * 此处采用预先创建的 tempCanvas 避免频繁创建。
 */
function drawHistogram(video, canvas, compensation) {
  if (video.readyState !== 4 || video.paused) return;

  // 1. 将视频帧绘制到临时 canvas 上以读取像素数据
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

  // 2. 统计 8 位直方图
  const imageData = tempCtx.getImageData(0, 0, downscaleWidth, downscaleHeight);
  const data = imageData.data;
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    // 每隔一个像素采样
    if (pixelIndex % 2 === 0) {
      const brightness = Math.floor(
        0.299 * data[i] +
        0.587 * data[i + 1] +
        0.114 * data[i + 2]
      );
      const adjusted = brightness * Math.pow(2, compensation);
      const adjustedBrightness = Math.min(Math.round(adjusted), 255);
      histogram[adjustedBrightness]++;
    }
  }

  // 3. 设置直方图画布尺寸（320×150）
  const histWidth = 320;
  const histHeight = 150;
  canvas.width = histWidth;
  canvas.height = histHeight;
  const maxCount = Math.max(...histogram) || 1;
  const scaleX = histWidth / 256; // 将 0～255 映射到画布宽度

  requestAnimationFrame(() => {
    // 4. 绘制直方图柱子
    ctx.clearRect(0, 0, histWidth, histHeight);
    for (let i = 0; i < 256; i++) {
      const binHeight = (histogram[i] / maxCount) * histHeight;
      // 过曝 (>245) 红色，欠曝 (<15) 蓝色，其余绿色
      ctx.fillStyle = i > 245 ? 'red' : i < 15 ? 'blue' : 'green';
      ctx.fillRect(i * scaleX, histHeight - binHeight, scaleX, binHeight);
    }

    // 5. 计算 Zone 边界
    // Zone 边界公式：b = referenceGray * 2^(zone - 5)
    // 其中 zoneNumbers 为 [2,3,4,5,6,7]
    const zoneNumbers = [2, 3, 4, 5, 6, 7];
    // 计算原始边界（未 clamp）
    const computedBoundaries = zoneNumbers.map(zone =>
      referenceGray * Math.pow(2, zone - 5)
    );
    // 对超出 255 的边界进行 clamp，并记录是否有区域被剪裁
    let clipped = false;
    const boundaries = computedBoundaries.map(b => {
      if (b > 255) {
        clipped = true;
        return 255;
      }
      return b;
    });
    // 将边界映射到画布 x 坐标
    const xBoundaries = boundaries.map(b => b * scaleX);

    // 6. 绘制可见的 Zone 分界线和标签
    ctx.save();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'black';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    // 只绘制那些计算结果未超出 255 的 Zone（通常 Zone3～Zone5会完全显示）
    for (let i = 1; i < zoneNumbers.length; i++) {
      if (computedBoundaries[i] <= 255) {
        const x = xBoundaries[i];
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, histHeight);
        ctx.stroke();
        // 在分界线附近标注 Zone（这里简单在 x 坐标右侧标注）
        ctx.fillText(`Z${zoneNumbers[i]}`, x + 5, 2);
      }
    }
    // 如果有区域超出 255，则在直方图最右侧显示 CLIPPED 标识
    if (clipped) {
      ctx.fillStyle = 'red';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('CLIPPED', histWidth - 5, 2);
    }
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
  // 校准因子（内部调整，不对用户暴露），推荐初始值为 0.85
  const [calibrationFactor] = useState(0.85);
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
                const smoothingFactor = 0.1;
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
        <p className="note">Note: Light metering is based on the assumption of a standard 18% gray card (calibration factor = 0.85).</p>
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
  
    // 根据测光模式，决定圆形大小
    const circleSize = meteringMode === 'spot' ? '5%' : '20%';
  
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
  
            {/* 
              1) 这里给视频和测光圈都包裹到一个带有 "video-container" 类名的 div 中 
              2) 后面在 CSS 里给 .video-container 设置 position: relative 
            */}
            <div className="video-container">
              <video ref={videoRef} className="video-preview" playsInline muted />
              <div
                className="metering-area"
                style={{
                  width: circleSize,
                  height: circleSize
                }}
              />
            </div>
  
            <canvas ref={histCanvasRef} className="histogram-canvas" />
            <canvas ref={canvasRef} className="hidden-canvas" />
  
            <div className="exposure-info">
              {error ? (
                <p className="error-message">{error}</p>
              ) : (
                <>
                  <p>
                    {priorityMode === 'shutter'
                      ? `Chosen Shutter: ${
                          exposure.shutterSpeed > 0 && exposure.shutterSpeed < 1
                            ? `1/${Math.round(1 / exposure.shutterSpeed)} sec`
                            : `${exposure.shutterSpeed
                                .toFixed(1)
                                .replace(/\.0$/, '')} sec`
                        }`
                      : `Chosen Aperture: f/${exposure.aperture}`}
                  </p>
                  <p>
                    Recommended {priorityMode === 'shutter' ? 'Aperture' : 'Shutter Speed'}:{' '}
                    {priorityMode === 'shutter'
                      ? exposure.aperture
                        ? `f/${
                            exposure.aperture % 1 === 0
                              ? exposure.aperture.toFixed(0)
                              : exposure.aperture.toFixed(1)
                          }`
                        : '--'
                      : exposure.shutterSpeed > 0 && exposure.shutterSpeed < 1
                      ? `1/${Math.round(1 / exposure.shutterSpeed)} sec`
                      : `${exposure.shutterSpeed
                          .toFixed(1)
                          .replace(/\.0$/, '')} sec`}
                  </p>
                  <p style={{ color: exposureWarningColor }}>
                    Current EV:{' '}
                    {Number.isFinite(exposure.smoothedEV)
                      ? exposure.smoothedEV.toFixed(1)
                      : 'N/A'}
                  </p>
                  <p>Scene: {getSceneDescription(exposure.smoothedEV)}</p>
                  <p className="note">
                    (Using{' '}
                    {meteringMode === 'center'
                      ? 'center-weighted (Central 20%, Gaussian Weighting)'
                      : 'spot (Central 5% area)'}{' '}
                    metering, ISO = {iso}, EV Compensation = {compensation}, Priority Mode ={' '}
                    {priorityMode}, Calibration Factor = {calibrationFactor})
                  </p>
                  <p className="note">
                    EV formula: EV = {referenceEV} + log₂((Brightness × {calibrationFactor})/
                    {referenceGray}) + log₂(ISO/100)
                  </p>
                  <p>Exposure difference: {Math.abs(exposure.evDifference).toFixed(1)} EV</p>
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