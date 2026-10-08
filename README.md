# 🧭 Campus Navigation Guide

An interactive, single-page web application that helps new students navigate their campus — from the **Main Gate** to every key building — with a live SVG map, step-by-step walking directions, and real-time open/closed status.

## ✨ Features

| Feature | Details |
|---|---|
| 🗺️ **Interactive SVG Map** | Clickable, keyboard-navigable campus map with colour-coded building zones |
| 📋 **Synced List View** | Sidebar list and map always stay in sync — selecting one highlights the other |
| 🔴🟡🟢 **Live Open/Closed Status** | Badges update every 30 s based on each building's real opening hours |
| 🚶 **Animated Walking Routes** | Dashed, animated route drawn from the Main Gate to any selected building |
| ⭐ **Local Storage Favourites** | Save favourite locations; persisted across sessions via `localStorage` |
| 🔍 **Instant Search** | Filter locations by name, category, or description in real time |
| ⌨️ **Full Keyboard Support** | `/` to search, arrow keys on map, `F` to favourite, `Esc` to close |
| 📱 **Responsive / Mobile-first** | Bottom-sheet info panel on mobile; two-column layout on desktop |
| ♿ **Accessible** | ARIA roles, live regions, focus management, reduced-motion support |

## 🏛️ Campus Locations

- Main Gate · Administration Block · Central Library
- Student Canteen · Computer Science Labs · Science & Engineering Labs
- Student Hostel · Sports Ground

## 🚀 Getting Started

No build step required — it's plain HTML, CSS, and JavaScript.

```bash
# Clone the repo
git clone https://github.com/vritika110/campus-navigation-guide.git
cd campus-navigation-guide

# Serve locally (fetch() requires a server)
python -m http.server 8000
# then open http://localhost:8000
```

> **Note:** Opening `index.html` directly from disk (`file://`) will cause `data.json` to fail to load due to browser CORS restrictions. Always use a local server or the live hosted URL.

## 🛠️ Tech Stack

- **HTML5** — semantic markup, ARIA attributes
- **Tailwind CSS** (CDN) — layout & typography utilities
- **Vanilla CSS** — SVG map, animations, mobile bottom sheet
- **Vanilla JavaScript** (ES2020, IIFE) — all app logic, no frameworks

## 📁 Project Structure

```
campus-navigation-guide/
├── index.html   # App shell & SVG map skeleton
├── styles.css   # Map styles, animations, mobile sheet
├── app.js       # All application logic (state → render)
└── data.json    # Campus locations, routes, and timings
```

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `/` | Focus the search box |
| `↑` / `↓` | Browse the location list |
| Arrow keys (on map) | Jump to nearest building |
| `Enter` | Select focused building |
| `F` | Save / unsave current location |
| `Esc` | Close the details panel |

## 📄 License

MIT — feel free to adapt for your own campus!
