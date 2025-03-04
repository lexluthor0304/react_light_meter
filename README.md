# 📷 Film Camera Light Meter (React 19 + PWA)

This is a **Film Camera Light Meter** web application built with **React 19**, featuring:
- **Accurate exposure metering** using **manual settings**
- **Center-weighted metering** algorithm
- **Real-time histogram analysis**
- **Progressive Web App (PWA) support** for offline functionality
- **SEO optimized** with correct `<title>` and `<meta>` tags in React 19

---

## 🛠 Features

✅ **Accurate Exposure Calculation**  
Uses a **center-weighted metering system** to determine the correct exposure values based on a manually controlled **ISO and exposure compensation (EV).**

✅ **Shutter Speed & Aperture Suggestions**  
Recommends **shutter speed** and **aperture** based on calculated **Exposure Value (EV).**

✅ **Real-time Histogram Display**  
Analyzes video frames in real-time and **renders a histogram** with brightness distribution.

✅ **Manual Exposure Mode Support**  
Attempts to disable **Auto Exposure (AE)** on supported devices to improve metering accuracy.

✅ **Progressive Web App (PWA) Support**  
- Works **offline** using service workers  
- Can be **installed** as a standalone app  
- Provides a **manifest.json** for mobile optimization  

✅ **SEO & Social Sharing Optimized**  
- Uses **React 19** built-in `<title>` and `<meta>` tag handling  
- Supports **Open Graph (OG)** and **Twitter Cards** for social media previews  

---

## 🚀 Live Demo

👉 **[Try it here](http://yourwebsite.com)**

---

## 📦 Installation

### 1️⃣ Clone the Repository
```sh
git clone https://github.com/yourusername/react-light-meter.git
cd react-light-meter
```

### 2️⃣ Install Dependencies
```sh
npm install
```

### 3️⃣ Start the Development Server
```sh
npm start
```
Then, open **http://localhost:3000** in your browser.

---

## 🏗 Build & Deploy

### 1️⃣ Build for Production
```sh
npm run build
```

### 2️⃣ Deploy (Example: GitHub Pages)
```sh
npm install -g serve
serve -s build
```

---

## 📲 How to Use

### **Step 1: Grant Camera Access**
- Click **"Allow Camera Access"** to start measuring exposure.

### **Step 2: Select ISO & Exposure Compensation**
- Choose **ISO value** (e.g., 100, 200, 400, etc.).
- Adjust **Exposure Compensation (EV)** if needed.

### **Step 3: Measure Exposure**
- The app displays:
  - **Recommended Shutter Speed & Aperture**
  - **Current Exposure Value (EV)**
  - **Real-time Histogram**
  
---

## 🛠 Technologies Used

- **React 19** (Latest version)
- **PWA (Progressive Web App)**
- **Service Worker & Offline Caching**
- **SEO Optimized with React `<title>` and `<meta>`**
- **JavaScript (ES6+)**
- **CSS3**
- **WebRTC (Camera Access)**
- **Canvas API (Histogram & Brightness Analysis)**

---

## 🔥 PWA Support

This app is **fully PWA-compliant**, meaning:
- **Offline functionality** via **Service Worker**
- **Add to Home Screen** on mobile devices
- **Manifest.json** for better mobile UX

To test PWA functionality:
1. Run `npm run build`
2. Deploy it to a server (e.g., **Netlify**, **Vercel**, **GitHub Pages**)
3. Open in Chrome and check **Lighthouse PWA audit**

---

## 🔧 Project Structure

```
/react_light_meter
 ├── /public
 │   ├── index.html           # Main HTML file
 │   ├── manifest.json        # PWA manifest file
 │   ├── service-worker.js    # Service worker for offline caching
 │   ├── icons/               # App icons for PWA
 ├── /src
 │   ├── App.js               # Main React component
 │   ├── serviceWorkerRegistration.js # Registers service worker
 │   ├── index.js             # React app entry point
 │   ├── App.css              # Styles
 ├── package.json             # Dependencies & scripts
 ├── README.md                # Documentation (this file)
```

---

## 🎨 UI Preview

📸 **Light Meter Interface**
```
---------------------------------------
| 📷 [Live Camera Preview]           |
| ----------------------------------- |
| 🔢 ISO: [100 ▼]   EV Compensation: |
| ⚙️ [Adjust Settings]               |
| ----------------------------------- |
| ⏳ Shutter Speed: 1/60 sec         |
| 🔲 Aperture: f/5.6                 |
| 📊 [Real-Time Histogram]           |
---------------------------------------
```

---

## 🛡 Security & Permissions

- **Uses only camera permission**
- **No external API calls**
- **Works completely offline**

---

## 🛠 Customization

### **Change SEO Metadata**
Edit `<title>` and `<meta>` tags inside `App.js`:

```jsx
<title>Film Camera Light Meter</title>
<meta name="description" content="A PWA-based film camera light meter" />
<meta name="keywords" content="film, camera, light meter, exposure" />
```

### **Modify PWA Settings**
Edit **public/manifest.json** to change:
- App name, theme color, start URL, icons, etc.

---

## 🐛 Known Issues & Future Improvements

- Some **mobile devices** do not support **manual exposure mode**.
- Histogram accuracy **may vary** due to **automatic white balance (AWB).**
- Future improvements:
  - **Improve low-light detection**
  - **Add spot metering option**

---

## 👨‍💻 Contributing

💡 Want to improve the project? Feel free to fork and submit PRs.

---

## 📄 License

📝 MIT License. Free for personal & commercial use.

---

### 🎯 Credits

Built with ❤️ by [Lexluthor0304](https://github.com/lexluthor0304)
