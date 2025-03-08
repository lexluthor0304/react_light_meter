// App.js
import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import GoogleTag from "./GoogleTag.js";
import GoogleAnalytics from "./GoogleAnalytics.js";

// 预先创建临时 canvas，用于直方图绘制，避免频繁创建销毁
const tempCanvas = document.createElement('canvas');

// Gamma 校正：sRGB 转换到线性 RGB
const linearize = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

// ISO 和曝光补偿可选值
const isoValues = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 3200];
const compensationSteps = [-3, -2.7, -2.3, -2, -1.7, -1.3, -1, -0.7, -0.3, 0, 0.3, 0.7, 1, 1.3, 1.7, 2, 2.3, 2.7, 3];

// 直方图阈值初始值
const DEFAULT_OVEREXPOSURE_THRESHOLD = 245;
const DEFAULT_UNDEREXPOSURE_THRESHOLD = 15;

/**
 * DocumentMetadata – 页面 Meta 标签
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
      <meta property="og:url" content="http://tokugai.com" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Film Camera Light Meter" />
      <meta
        name="twitter:description"
        content="Accurate exposure metering for film cameras using manual settings, center-weighted analysis and real-time histogram."
      />
      <link rel="canonical" href="http://tokugai.com" />
      {/* 苹果设备及移动端优化 */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="format-detection" content="telephone=no, email=no, address=no" />
      <meta name="msapplication-tap-highlight" content="no" />
    </>
  );
}

// 快门速度和光圈数据
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

// 定义18%灰卡对应的参考值
const referenceGray = 128;
const referenceEV = 7;

/****************************************************
 * 计算视频帧中心区域的平均亮度
 * 转换为线性 RGB 后计算亮度（乘以255恢复范围）
 ****************************************************/
function computeBrightness(video, canvas, meteringMode) {
  if (video.readyState !== 4 || video.paused) return 0;
  const ctx = canvas.getContext('2d');
  const { videoWidth: width, videoHeight: height } = video;
  if (width === 0 || height === 0) return 0;
  
  const downscaleWidth = Math.min(640, width);
  const downscaleHeight = Math.min(480, height);
  canvas.width = downscaleWidth;
  canvas.height = downscaleHeight;
  ctx.drawImage(video, 0, 0, downscaleWidth, downscaleHeight);
  
  let regionWidth, regionHeight;
  if (meteringMode === 'spot') {
    regionWidth = downscaleWidth * 0.03;
    regionHeight = downscaleHeight * 0.03;
  } else {
    regionWidth = downscaleWidth * 0.2;
    regionHeight = downscaleHeight * 0.2;
  }
  const startX = (downscaleWidth - regionWidth) / 2;
  const startY = (downscaleHeight - regionHeight) / 2;
  const imageData = ctx.getImageData(startX, startY, regionWidth, regionHeight);
  const data = imageData.data;
  
  let total = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luminance = (0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)) * 255;
    total += luminance;
    count++;
  }
  return count ? total / count : 0;
}

/****************************************************
 * 计算 EV 值
 * EV = referenceEV + log₂((avgBrightness × calibrationFactor)/referenceGray) + log₂(ISO/100)
 ****************************************************/
function calculateEffectiveEV(avgBrightness, iso, compensation, calibrationFactor = 1.0) {
  if (avgBrightness <= 0) return -Infinity;
  const measuredEV =
    referenceEV +
    Math.log2((avgBrightness * calibrationFactor) / referenceGray) +
    Math.log2(iso / 100);
  return measuredEV + compensation;
}

/****************************************************
 * 快门优先曝光计算
 ****************************************************/
function calculateExposureShutterPriority(avgBrightness, iso, compensation, chosenShutter, calibrationFactor = 1.0) {
  const effectiveEV = calculateEffectiveEV(avgBrightness, iso, compensation, calibrationFactor);
  const candidates = shutterApertureEV.filter(c => c.shutter === chosenShutter);
  let closestCandidate = null, minDiff = Infinity;
  candidates.forEach(candidate => {
    const diff = Math.abs(candidate.ev - effectiveEV);
    if (diff < minDiff) {
      minDiff = diff;
      closestCandidate = candidate;
    }
  });
  const evDifference = closestCandidate ? closestCandidate.ev - effectiveEV : 0;
  return { shutterSpeed: chosenShutter, aperture: closestCandidate ? closestCandidate.aperture : 0, effectiveEV, evDifference };
}

/****************************************************
 * 光圈优先曝光计算
 ****************************************************/
function calculateExposureAperturePriority(avgBrightness, iso, compensation, chosenAperture, calibrationFactor = 1.0) {
  const effectiveEV = calculateEffectiveEV(avgBrightness, iso, compensation, calibrationFactor);
  const candidates = shutterApertureEV.filter(c => c.aperture === chosenAperture);
  let closestCandidate = null, minDiff = Infinity;
  candidates.forEach(candidate => {
    const diff = Math.abs(candidate.ev - effectiveEV);
    if (diff < minDiff) {
      minDiff = diff;
      closestCandidate = candidate;
    }
  });
  const evDifference = closestCandidate ? closestCandidate.ev - effectiveEV : 0;
  return { shutterSpeed: closestCandidate ? closestCandidate.shutter : 0, aperture: chosenAperture, effectiveEV, evDifference };
}

/****************************************************
 * 绘制直方图
 * 当 colorChannelMode 为 'combined' 时使用整体亮度直方图；
 * 为 'separate' 时分别绘制 R、G、B 通道直方图。
 ****************************************************/
function drawHistogram(video, canvas, compensation, underExposureThreshold, overExposureThreshold, colorChannelMode = 'combined') {
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
  
  if (colorChannelMode === 'combined') {
    const imageData = tempCtx.getImageData(0, 0, downscaleWidth, downscaleHeight);
    const data = imageData.data;
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      if ((i / 4) % 2 === 0) {
        const brightness = Math.floor(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        const adjusted = brightness * Math.pow(2, compensation);
        const adjustedBrightness = Math.min(Math.round(adjusted), 255);
        histogram[adjustedBrightness]++;
      }
    }
    const histWidth = 320, histHeight = 150;
    canvas.width = histWidth;
    canvas.height = histHeight;
    const maxCount = Math.max(...histogram) || 1;
    const scaleX = histWidth / 256;
    ctx.clearRect(0, 0, histWidth, histHeight);
    for (let i = 0; i < 256; i++) {
      const binHeight = (histogram[i] / maxCount) * histHeight;
      ctx.fillStyle = i > overExposureThreshold ? 'red' : i < underExposureThreshold ? 'blue' : 'green';
      ctx.fillRect(i * scaleX, histHeight - binHeight, scaleX, binHeight);
    }
  } else if (colorChannelMode === 'separate') {
    const imageData = tempCtx.getImageData(0, 0, downscaleWidth, downscaleHeight);
    const data = imageData.data;
    const redHistogram = new Array(256).fill(0);
    const greenHistogram = new Array(256).fill(0);
    const blueHistogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      if ((i / 4) % 2 === 0) {
        redHistogram[data[i]]++;
        greenHistogram[data[i + 1]]++;
        blueHistogram[data[i + 2]]++;
      }
    }
    const histWidth = 320, histHeight = 150;
    canvas.width = histWidth;
    canvas.height = histHeight;
    const sliceWidth = histWidth / 3;
    const maxRed = Math.max(...redHistogram) || 1;
    const maxGreen = Math.max(...greenHistogram) || 1;
    const maxBlue = Math.max(...blueHistogram) || 1;
    ctx.clearRect(0, 0, histWidth, histHeight);
    for (let i = 0; i < 256; i++) {
      const binHeightR = (redHistogram[i] / maxRed) * histHeight;
      ctx.fillStyle = 'red';
      ctx.fillRect((i / 256) * sliceWidth, histHeight - binHeightR, sliceWidth / 256, binHeightR);
      const binHeightG = (greenHistogram[i] / maxGreen) * histHeight;
      ctx.fillStyle = 'green';
      ctx.fillRect(sliceWidth + (i / 256) * sliceWidth, histHeight - binHeightG, sliceWidth / 256, binHeightG);
      const binHeightB = (blueHistogram[i] / maxBlue) * histHeight;
      ctx.fillStyle = 'blue';
      ctx.fillRect(2 * sliceWidth + (i / 256) * sliceWidth, histHeight - binHeightB, sliceWidth / 256, binHeightB);
    }
  }
}

/****************************************************
 * 根据 EV 值返回场景描述
 ****************************************************/
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
  const [iso, setIso] = useState(100);
  const [compensation, setCompensation] = useState(0);
  const [priorityMode, setPriorityMode] = useState('aperture'); // 'shutter' 或 'aperture'
  const [calibrationFactor, setCalibrationFactor] = useState(0.85);
  const [meteringMode, setMeteringMode] = useState('center');
  // 新增状态变量
  const [smoothingFactor, setSmoothingFactor] = useState(0.1);
  const [colorChannelMode, setColorChannelMode] = useState('combined');
  const [filmPreset, setFilmPreset] = useState('custom');
  const filmPresets = {
    'Kodak Portra 400': {
      calibrationFactor: 0.92,
      overExposureThreshold: 250,
      underExposureThreshold: 10,
      recommendedCompensation: 0.3,
      description: 'Warm tones, excellent skin rendition, slight contrast boost.',
    },
    'Ilford HP5': {
      calibrationFactor: 0.85,
      overExposureThreshold: 245,
      underExposureThreshold: 15,
      recommendedCompensation: 0.0,
      description: 'Classic black & white film with moderate contrast.',
    },
    'Fuji Superia X-TRA 400': {
      calibrationFactor: 0.88,
      overExposureThreshold: 248,
      underExposureThreshold: 12,
      recommendedCompensation: 0.2,
      description: 'Versatile color film delivering vibrant hues with moderate contrast.',
    },
    'Kodak Tri-X 400': {
      calibrationFactor: 0.87,
      overExposureThreshold: 240,
      underExposureThreshold: 18,
      recommendedCompensation: 0.0,
      description: 'High contrast black & white film, forgiving of slight exposure errors.',
    },
    'Kodak Portra 160': {
      calibrationFactor: 0.93,
      overExposureThreshold: 255,
      underExposureThreshold: 8,
      recommendedCompensation: 0.2,
      description: 'Low ISO film with fine grain and natural color reproduction.',
    },
    'Fujifilm Pro 400H': {
      calibrationFactor: 0.90,
      overExposureThreshold: 252,
      underExposureThreshold: 10,
      recommendedCompensation: 0.1,
      description: 'Soft contrast and pastel tones, ideal for portrait photography.',
    },
    'Kodak Ektar 100': {
      calibrationFactor: 0.95,
      overExposureThreshold: 255,
      underExposureThreshold: 5,
      recommendedCompensation: 0.2,
      description: 'Highly saturated, vivid color film with fine grain.',
    },
    'Fujifilm Velvia 50': {
      calibrationFactor: 0.94,
      overExposureThreshold: 253,
      underExposureThreshold: 6,
      recommendedCompensation: 0.4,
      description: 'High contrast and vibrant color slide film, excellent for landscapes.',
    },
    'Fujifilm Provia 100F': {
      calibrationFactor: 0.91,
      overExposureThreshold: 250,
      underExposureThreshold: 8,
      recommendedCompensation: 0.1,
      description: 'Slide film with natural color rendition and fine grain.',
    },
    'Kodak Gold 200': {
      calibrationFactor: 0.93,
      overExposureThreshold: 248,
      underExposureThreshold: 12,
      recommendedCompensation: 0.1,
      description: 'Budget color negative film with warm tones and moderate saturation.',
    },
    'Ilford Delta 3200': {
      calibrationFactor: 0.86,
      overExposureThreshold: 240,
      underExposureThreshold: 20,
      recommendedCompensation: 0.0,
      description: 'High speed black & white film, ideal for low light with distinctive grain.',
    },
    'AgfaPhoto Vista Plus 200': {
      calibrationFactor: 0.92,
      overExposureThreshold: 250,
      underExposureThreshold: 10,
      recommendedCompensation: 0.0,
      description: 'Affordable color negative film with balanced contrast and color.',
    },
    'Cinestill 800T': {
      calibrationFactor: 0.89,
      overExposureThreshold: 247,
      underExposureThreshold: 15,
      recommendedCompensation: 0.2,
      description: 'Tungsten-balanced film for night photography with a unique halation effect.',
    },
    'Lomography Color Negative 400': {
      calibrationFactor: 0.90,
      overExposureThreshold: 250,
      underExposureThreshold: 10,
      recommendedCompensation: 0.0,
      description: 'Creative color negative film with saturated colors and soft contrast.',
    },
    'Fujifilm Natura 1600': {
      calibrationFactor: 0.88,
      overExposureThreshold: 245,
      underExposureThreshold: 15,
      recommendedCompensation: 0.0,
      description: 'High speed color film with natural tones in low light conditions.',
    },
    'Ilford Pan F Plus 50': {
      calibrationFactor: 0.95,
      overExposureThreshold: 255,
      underExposureThreshold: 5,
      recommendedCompensation: 0.2,
      description: 'Low ISO black & white film with extremely fine grain and high resolution.',
    },
    'Rollei Retro 80S': {
      calibrationFactor: 0.90,
      overExposureThreshold: 250,
      underExposureThreshold: 10,
      recommendedCompensation: 0.0,
      description: 'High contrast black & white film known for its unique tonality.',
    },
    // 可根据需要进一步扩充更多胶片预设……
  };
  const [aeLocked, setAeLocked] = useState(false);
  const lockedEVRef = useRef(null);
  const [chosenAperture, setChosenAperture] = useState(2.8);
  const [chosenShutter, setChosenShutter] = useState(1/125);
  const [overExposureThreshold, setOverExposureThreshold] = useState(DEFAULT_OVEREXPOSURE_THRESHOLD);
  const [underExposureThreshold, setUnderExposureThreshold] = useState(DEFAULT_UNDEREXPOSURE_THRESHOLD);
  const [exposure, setExposure] = useState({ shutterSpeed: 0, aperture: 0, effectiveEV: 0, smoothedEV: 0, evDifference: 0 });
  const [exposureWarning, setExposureWarning] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const histCanvasRef = useRef(null);
  const smoothedEVRef = useRef(null);

  function handleAutoCalibrate() {
    if (videoRef.current && canvasRef.current) {
      const avgBrightness = computeBrightness(videoRef.current, canvasRef.current, meteringMode);
      if (avgBrightness > 0) {
        const newFactor = referenceGray / avgBrightness;
        setCalibrationFactor(parseFloat(newFactor.toFixed(2)));
      }
    }
  }

  function handleAeLock() {
    if (aeLocked) {
      setAeLocked(false);
      lockedEVRef.current = null;
    } else {
      lockedEVRef.current = exposure.effectiveEV;
      setAeLocked(true);
    }
  }

  useEffect(() => {
    localStorage.setItem('iso', iso);
    localStorage.setItem('compensation', compensation);
    localStorage.setItem('priorityMode', priorityMode);
    localStorage.setItem('calibrationFactor', calibrationFactor);
    localStorage.setItem('overExposureThreshold', overExposureThreshold);
    localStorage.setItem('underExposureThreshold', underExposureThreshold);
  }, [iso, compensation, priorityMode, calibrationFactor, overExposureThreshold, underExposureThreshold, meteringMode]);

  useEffect(() => {
    const storedIso = parseInt(localStorage.getItem('iso'), 10);
    if (!isNaN(storedIso)) setIso(storedIso);
    const storedCompensation = parseFloat(localStorage.getItem('compensation'));
    if (!isNaN(storedCompensation)) setCompensation(storedCompensation);
    const storedPriority = localStorage.getItem('priorityMode');
    if (storedPriority) setPriorityMode(storedPriority);
    const storedCalibration = parseFloat(localStorage.getItem('calibrationFactor'));
    if (!isNaN(storedCalibration)) setCalibrationFactor(storedCalibration);
    const storedOver = parseInt(localStorage.getItem('overExposureThreshold'), 10);
    if (!isNaN(storedOver)) setOverExposureThreshold(storedOver);
    const storedUnder = parseInt(localStorage.getItem('underExposureThreshold'), 10);
    if (!isNaN(storedUnder)) setUnderExposureThreshold(storedUnder);
  }, []);

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
            const avgBrightness = computeBrightness(videoRef.current, canvasRef.current, meteringMode);
            if (avgBrightness < 5) {
              setError('Extremely dark, increase ISO/aperture.');
            } else if (avgBrightness > 250) {
              setError('Extremely bright! Reduce ISO or aperture.');
            } else {
              setError('');
              let exp;
              if (priorityMode === 'aperture') {
                exp = calculateExposureAperturePriority(avgBrightness, iso, compensation, chosenAperture, calibrationFactor);
              } else {
                exp = calculateExposureShutterPriority(avgBrightness, iso, compensation, chosenShutter, calibrationFactor);
              }
              let currentEV = exp.effectiveEV;
              if (smoothedEVRef.current === null) {
                smoothedEVRef.current = currentEV;
              } else {
                smoothedEVRef.current = smoothedEVRef.current * (1 - smoothingFactor) + currentEV * smoothingFactor;
              }
              exp.smoothedEV = smoothedEVRef.current;
              // AE-Lock：如果已锁定，则使用锁定的 EV
              if (aeLocked && lockedEVRef.current !== null) {
                exp.effectiveEV = lockedEVRef.current;
              }
              setExposure(exp);
              if (exp.evDifference <= -1) {
                setExposureWarning('Severely underexposed, increase aperture or ISO significantly.');
              } else if (exp.evDifference <= -0.6) {
                setExposureWarning('Moderately underexposed, consider increasing aperture or ISO.');
              } else if (exp.evDifference <= -0.3) {
                setExposureWarning('Slightly underexposed, fine-tune settings.');
              } else if (exp.evDifference >= 1) {
                setExposureWarning('Severely overexposed, reduce aperture or ISO significantly.');
              } else if (exp.evDifference >= 0.6) {
                setExposureWarning('Moderately overexposed, consider reducing aperture or ISO.');
              } else if (exp.evDifference >= 0.3) {
                setExposureWarning('Slightly overexposed, fine-tune settings.');
              } else {
                setExposureWarning('');
              }
            }
            drawHistogram(videoRef.current, histCanvasRef.current, compensation, underExposureThreshold, overExposureThreshold, colorChannelMode);
          }
        } catch (e) {
          console.error(e);
          setError('Measurement error');
        }
      }, 100);
      return () => clearInterval(intervalId);
    }
  }, [step, stream, iso, compensation, priorityMode, calibrationFactor, underExposureThreshold, overExposureThreshold, chosenAperture, chosenShutter, smoothingFactor, colorChannelMode, aeLocked, meteringMode]);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  const requestCamera = async () => {
    setIsLoading(true);
    if (/iPhone/.test(navigator.userAgent)) {
      alert('iPhone camera may use auto-exposure. For best results, use manual compensation or calibration.');
    }
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
      setStep('iso');
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Unable to access camera. Please check your permissions.');
    } finally {
      setIsLoading(false);
    }
  };

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

  if (step === 'iso') {
    return (
      <div className="container">
        <DocumentMetadata />
        <h1 className="title">Set ISO, Exposure Compensation, Priority & Metering Mode</h1>
        <p className="note">Note: Light metering is based on a standard 18% gray card (calibration factor adjustable).</p>
        <div className="input-group">
          <label>
            ISO:
            <select value={iso} onChange={(e) => setIso(parseInt(e.target.value))} className="select">
              {isoValues.map(value => (<option key={value} value={value}>ISO {value}</option>))}
            </select>
          </label>
        </div>
        <div className="input-group">
          <label>
            Exposure Compensation:
            <select value={compensation} onChange={(e) => setCompensation(parseFloat(e.target.value))} className="select">
              {compensationSteps.map(stepValue => (<option key={stepValue} value={stepValue}>{stepValue} EV</option>))}
            </select>
          </label>
        </div>
        <div className="input-group">
          <label>
            Calibration Factor:
            <input type="number" value={calibrationFactor} onChange={(e) => setCalibrationFactor(parseFloat(e.target.value))} step={0.01} min={0.5} max={1.5} />
          </label>
          <button onClick={handleAutoCalibrate} className="btn small">Auto Calibrate Gray Card</button>
        </div>
        <div className="input-group">
          <label>
            Priority Mode:
            <select value={priorityMode} onChange={(e) => setPriorityMode(e.target.value)} className="select">
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
            <select value={meteringMode} onChange={(e) => setMeteringMode(e.target.value)} className="select">
              <option value="center">Center Weighted (Central 20%, Gaussian Weighting)</option>
              <option value="spot">Spot Meter (Central 3% area)</option>
            </select>
          </label>
        </div>
        <div className="input-group">
          <label>
            Color Channel Mode:
            <select value={colorChannelMode} onChange={(e) => setColorChannelMode(e.target.value)} className="select">
              <option value="combined">Combined</option>
              <option value="separate">Separate</option>
            </select>
          </label>
        </div>
        <div className="input-group">
          <label>
            Film Preset:
            <select
              value={filmPreset}
              onChange={(e) => {
                setFilmPreset(e.target.value);
                if (e.target.value !== 'custom') {
                  const preset = filmPresets[e.target.value];
                  setCalibrationFactor(preset.calibrationFactor);
                  setOverExposureThreshold(preset.overExposureThreshold);
                  setUnderExposureThreshold(preset.underExposureThreshold);
                  setCompensation(preset.recommendedCompensation);
                }
              }}
              className="select"
            >
              <option value="custom">Custom</option>
              <option value="Kodak Portra 400">Kodak Portra 400</option>
              <option value="Ilford HP5">Ilford HP5</option>
              <option value="Fuji Superia X-TRA 400">Fuji Superia X-TRA 400</option>
              <option value="Kodak Tri-X 400">Kodak Tri-X 400</option>
              <option value="Kodak Portra 160">Kodak Portra 160</option>
              <option value="Fujifilm Pro 400H">Fujifilm Pro 400H</option>
              <option value="Kodak Ektar 100">Kodak Ektar 100</option>
              <option value="Fujifilm Velvia 50">Fujifilm Velvia 50</option>
              <option value="Fujifilm Provia 100F">Fujifilm Provia 100F</option>
              <option value="Kodak Gold 200">Kodak Gold 200</option>
              <option value="Ilford Delta 3200">Ilford Delta 3200</option>
              <option value="AgfaPhoto Vista Plus 200">AgfaPhoto Vista Plus 200</option>
              <option value="Cinestill 800T">Cinestill 800T</option>
              <option value="Lomography Color Negative 400">Lomography Color Negative 400</option>
              <option value="Fujifilm Natura 1600">Fujifilm Natura 1600</option>
              <option value="Ilford Pan F Plus 50">Ilford Pan F Plus 50</option>
              <option value="Rollei Retro 80S">Rollei Retro 80S</option>
            </select>
          </label>
        </div>
        <div className="input-group">
          <label>
            EV Smoothing Factor:
            <input type="number" value={smoothingFactor} onChange={(e) => setSmoothingFactor(parseFloat(e.target.value))} step={0.01} min={0.05} max={0.3} />
          </label>
        </div>
        <div className="input-group">
          <label>
            Over Exposure Threshold:
            <input type="number" value={overExposureThreshold} onChange={(e) => setOverExposureThreshold(parseInt(e.target.value))} />
          </label>
        </div>
        <div className="input-group">
          <label>
            Under Exposure Threshold:
            <input type="number" value={underExposureThreshold} onChange={(e) => setUnderExposureThreshold(parseInt(e.target.value))} />
          </label>
        </div>
        <button onClick={() => setStep('meter')} className="btn">Confirm & Start Metering</button>
      </div>
    );
  }

  if (step === 'meter') {
    const evDifference = Math.abs(exposure.smoothedEV - exposure.effectiveEV);
    let exposureWarningColor = 'green';
    if (evDifference >= 0.6) exposureWarningColor = 'red';
    else if (evDifference >= 0.3) exposureWarningColor = 'orange';
    const circleSize = meteringMode === 'spot' ? '3%' : '20%';
    return (
      <>
        <GoogleAnalytics trackingId="G-1ZZ5X14QXX" />
        <GoogleTag trackingId="G-1ZZ5X14QXX" />
        <div className="meter-container">
          <DocumentMetadata />
          <header className="meter-header">
            <button onClick={() => setStep('iso')} className="btn small">Back</button>
            <button onClick={handleAeLock} className="btn small">{aeLocked ? 'Unlock AE' : 'AE Lock'}</button>
            <h1 className="header-title">Measuring Exposure</h1>
            <div></div>
          </header>
          <main className="meter-main">
            <div className="video-container">
              <video ref={videoRef} className="video-preview" playsInline muted />
              <div className="metering-area" style={{ width: circleSize, height: circleSize }} />
            </div>
            <canvas ref={histCanvasRef} className="histogram-canvas" />
            <canvas ref={canvasRef} className="hidden-canvas" />
            <div className="exposure-info">
              {error ? (
                <div className="error-message">
                  <p>{error}</p>
                  <button onClick={() => setStep('iso')}>Adjust Settings</button>
                </div>
              ) : (
                <>
                  <p>
                    {priorityMode === 'shutter'
                      ? `Chosen Shutter: ${exposure.shutterSpeed > 0 && exposure.shutterSpeed < 1 ? `1/${Math.round(1 / exposure.shutterSpeed)} sec` : `${exposure.shutterSpeed.toFixed(1).replace(/\\.0$/, '')} sec`}`
                      : `Chosen Aperture: f/${exposure.aperture}`}
                  </p>
                  <p>
                    Recommended {priorityMode === 'shutter' ? 'Aperture' : 'Shutter Speed'}: {priorityMode === 'shutter'
                      ? (exposure.aperture ? `f/${exposure.aperture % 1 === 0 ? exposure.aperture.toFixed(0) : exposure.aperture.toFixed(1)}` : '--')
                      : (exposure.shutterSpeed > 0 && exposure.shutterSpeed < 1 ? `1/${Math.round(1 / exposure.shutterSpeed)} sec` : `${exposure.shutterSpeed.toFixed(1).replace(/\\.0$/, '')} sec`)}
                  </p>
                  <p style={{ color: exposureWarningColor }}>
                    Current EV: {Number.isFinite(exposure.smoothedEV) ? exposure.smoothedEV.toFixed(1) : 'N/A'}
                  </p>
                  <p>Scene: {getSceneDescription(exposure.smoothedEV)}</p>
                  <p className="note">
                    (Using {meteringMode === 'center'
                      ? 'center-weighted (Central 20%, Gaussian Weighting)'
                      : 'spot (Central 3% area)'} metering, ISO = {iso}, EV Compensation = {compensation}, Priority Mode = {priorityMode}, Calibration Factor = {calibrationFactor})
                  </p>
                  <p className="note">
                    EV formula: EV = {referenceEV} + log₂((Brightness × {calibrationFactor})/{referenceGray}) + log₂(ISO/100)
                  </p>
                  <p>Exposure difference: {Math.abs(exposure.evDifference).toFixed(1)} EV</p>
                  {exposureWarning && <p className="warning">{exposureWarning}</p>}
                </>
              )}
            </div>
          </main>
          <footer className="app-footer">
            <p>© {new Date().getFullYear()} Film Camera Light Meter. tokugai.com All rights reserved.</p>
          </footer>
        </div>
      </>
    );
  }
  return null;
}

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